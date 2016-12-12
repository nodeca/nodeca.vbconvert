// Log users in using old vb password
//
'use strict';


const _      = require('lodash');
const crypto = require('crypto');


function md5(string) {
  return crypto.createHash('md5').update(string).digest('hex');
}


module.exports = function (N) {

  // Try to find auth data using `email_or_nick` as an email.
  //
  N.wire.on('server:users.auth.login.plain_exec', function* find_vb_authlink_by_email(env) {
    // user already verified, nothing left to do
    if (env.data.authLink) return;

    if (env.data.user && env.data.authLink_vb) return;

    let authLink = yield N.models.users.AuthLink.findOne()
                            .where('email').equals(env.params.email_or_nick)
                            .where('type').equals('vb')
                            .where('exists').equals(true)
                            .lean(true);

    // There is no error - let next hooks do their job.
    if (!authLink) return;

    let user = yield N.models.users.User.findOne()
                        .where('_id').equals(authLink.user)
                        .lean(true);

    // There is no error - let next hooks do their job.
    if (!user) return;

    env.data.user        = user;
    env.data.authLink_vb = authLink;
  });


  // Try to find auth data using `email_or_nick` as a nick.
  //
  N.wire.on('server:users.auth.login.plain_exec', function* find_vb_authlink_by_nick(env) {
    // user already verified, nothing left to do
    if (env.data.authLink) return;

    if (env.data.user && env.data.authLink_vb) return;

    let user = yield N.models.users.User.findOne()
                        .where('nick').equals(env.params.email_or_nick)
                        .lean(true);

    // There is no error - let next hooks do their job.
    if (!user) return;


    let authLink = yield N.models.users.AuthLink.findOne()
                            .where('user').equals(user._id)
                            .where('type').equals('vb')
                            .where('exists').equals(true)
                            .lean(true);

    // There is no error - let next hooks do their job.
    if (!authLink) return;

    env.data.user        = user;
    env.data.authLink_vb = authLink;
  });


  // If password is empty, send an email with a one-time link to log in
  //
  N.wire.on('server:users.auth.login.plain_exec', function* create_otp_email_token_vb(env) {
    if (!env.data.user || !env.data.authLink_vb) return;

    // user already verified by other hooks, nothing left to do
    if (env.data.authLink) return;

    if (!_.isEmpty(env.params.pass)) return;

    let token = yield N.models.users.TokenLoginByEmail.create({
      user:        env.data.user._id,
      ip:          env.req.ip,
      redirect_id: env.params.redirect_id,
      authlink:    env.data.authLink_vb._id
    });

    let general_project_name = yield N.settings.get('general_project_name');

    let link = env.helpers.link_to('users.auth.login.by_email_exec', {
      secret_key: token.secret_key
    });

    yield N.mailer.send({
      to:         env.data.authLink_vb.email,
      subject:    env.t('@users.auth.login.plain_exec.email_subject', { project_name: general_project_name }),
      text:       env.t('@users.auth.login.plain_exec.email_text',    { link, ip: env.req.ip }),
      safe_error: true
    });

    throw {
      code: N.io.REDIRECT,
      head: {
        Location: N.router.linkTo('users.auth.login.by_email_show')
      }
    };
  });


  // Try to login using vb authlink
  //
  N.wire.on('server:users.auth.login.plain_exec', function* verify_vb_authlink(env) {
    if (!env.data.user || !env.data.authLink_vb) return;

    // If plain authlink exists, it means the password was reset by means
    // other than logging in with vb password (e.g. using password recovery)
    //
    // In this case, just disable vb authlink and fail authentication
    //
    let plainAuthLink = yield N.models.users.AuthLink.findOne()
                                 .where('user').equals(env.data.user._id)
                                 .where('type').equals('plain')
                                 .where('exists').equals(true)
                                 .lean(true);

    if (plainAuthLink) {
      yield N.models.users.AuthLink.update({ _id: env.data.authLink_vb._id }, {
        $set: { exists: false }
      });

      return;
    }

    // trim and convert non-ascii ucs-2 characters to html entities
    let pass = env.params.pass.trim().split('').map(function (x) {
      return x.charCodeAt(0) > 255 ? '&#' + x.charCodeAt(0) + ';' : x;
    }).join('');

    if (env.data.authLink_vb.meta.pass === md5(md5(pass) + env.data.authLink_vb.meta.salt)) {
      // Password matches, in this case we disable vb authlink and create
      // plain authlink with submitted password
      //
      let authLink = new N.models.users.AuthLink({
        user:    env.data.user._id,
        type:    'plain',
        email:   env.data.authLink_vb.email,
        ip:      env.data.authLink_vb.ip,
        last_ip: env.data.authLink_vb.last_ip,
        ts:      env.data.authLink_vb.ts,
        last_ts: env.data.authLink_vb.last_ts
      });

      // Set a password user just submitted, note that it might be different
      // from a password he registered with (vB trims white space, we don't)
      //
      yield authLink.setPass(env.params.pass);
      yield authLink.save();

      // Disable vb authlink
      //
      yield N.models.users.AuthLink.update({ _id: env.data.authLink_vb._id }, {
        $set: { exists: false }
      });

      // Complete authentication using newly created authlink
      //
      env.data.authLink = authLink;
    }
  });
};
