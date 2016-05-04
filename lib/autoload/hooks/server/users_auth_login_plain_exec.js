// Log users in using old vb password
//
'use strict';


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


  // Try to login using vb authlink
  //
  N.wire.on('server:users.auth.login.plain_exec', function verify_vb_authlink(env) {
    if (!env.data.user || !env.data.authLink_vb) return;

    // trim and convert non-ascii ucs-2 characters to html entities
    let pass = env.params.pass.trim().split('').map(function (x) {
      return x.charCodeAt(0) > 255 ? '&#' + x.charCodeAt(0) + ';' : x;
    }).join('');

    if (env.data.authLink_vb.meta.pass === md5(md5(pass) + env.data.authLink_vb.meta.salt)) {
      env.data.authLink = env.data.authLink_vb;
    }
  });
};
