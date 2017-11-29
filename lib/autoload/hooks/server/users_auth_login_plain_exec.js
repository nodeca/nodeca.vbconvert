// Log users in using old vb password
//
'use strict';

/*
const _      = require('lodash');
const crypto = require('crypto');


function md5(string) {
  return crypto.createHash('md5').update(string).digest('hex');
}*/


module.exports = function (/*N*/) {

/*  // Try to find auth data using `email_or_nick` as an email.
  //
  N.wire.on('server:users.auth.login.plain_exec', async function find_vb_authprovider_by_email(env) {
    // user already verified, nothing left to do
    if (env.data.authProvider) return;

    if (env.data.user && env.data.authProvider_vb) return;

    let authProvider = await N.models.users.AuthProvider.findOne()
                            .where('email').equals(env.params.email_or_nick)
                            .where('type').equals('vb')
                            .where('exists').equals(true)
                            .lean(true);

    // There is no error - let next hooks do their job.
    if (!authProvider) return;

    let user = await N.models.users.User.findOne()
                        .where('_id').equals(authProvider.user)
                        .lean(true);

    // There is no error - let next hooks do their job.
    if (!user) return;

    env.data.user        = user;
    env.data.authProvider_vb = authProvider;
  });


  // Try to find auth data using `email_or_nick` as a nick.
  //
  N.wire.on('server:users.auth.login.plain_exec', async function find_vb_authprovider_by_nick(env) {
    // user already verified, nothing left to do
    if (env.data.authProvider) return;

    if (env.data.user && env.data.authProvider_vb) return;

    let user = await N.models.users.User.findOne()
                        .where('nick').equals(env.params.email_or_nick)
                        .lean(true);

    // There is no error - let next hooks do their job.
    if (!user) return;


    let authProvider = await N.models.users.AuthProvider.findOne()
                            .where('user').equals(user._id)
                            .where('type').equals('vb')
                            .where('exists').equals(true)
                            .lean(true);

    // There is no error - let next hooks do their job.
    if (!authProvider) return;

    env.data.user        = user;
    env.data.authProvider_vb = authProvider;
  });


  // Try to login using vb authprovider
  //
  N.wire.on('server:users.auth.login.plain_exec', async function verify_vb_authprovider(env) {
    if (!env.data.user || !env.data.authProvider_vb) return;

    // If plain authprovider exists, it means the password was reset by means
    // other than logging in with vb password (e.g. using password recovery)
    //
    // In this case, just disable vb authprovider and fail authentication
    //
    let plainAuthProvider = await N.models.users.AuthProvider.findOne()
                                 .where('user').equals(env.data.user._id)
                                 .where('type').equals('plain')
                                 .where('exists').equals(true)
                                 .lean(true);

    if (plainAuthProvider) {
      await N.models.users.AuthProvider.update({ _id: env.data.authProvider_vb._id }, {
        $set: { exists: false }
      });

      return;
    }

    // trim and convert non-ascii ucs-2 characters to html entities
    let pass = env.params.pass.trim().split('').map(function (x) {
      return x.charCodeAt(0) > 255 ? '&#' + x.charCodeAt(0) + ';' : x;
    }).join('');

    if (env.data.authProvider_vb.meta.pass === md5(md5(pass) + env.data.authProvider_vb.meta.salt)) {
      // Password matches, in this case we disable vb authprovider and create
      // plain authprovider with submitted password
      //
      let authProvider = new N.models.users.AuthProvider({
        user:    env.data.user._id,
        type:    'plain',
        email:   env.data.authProvider_vb.email,
        ip:      env.data.authProvider_vb.ip,
        last_ip: env.data.authProvider_vb.last_ip,
        ts:      env.data.authProvider_vb.ts,
        last_ts: env.data.authProvider_vb.last_ts
      });

      // Set a password user just submitted, note that it might be different
      // from a password he registered with (vB trims white space, we don't)
      //
      await authProvider.setPass(env.params.pass);
      await authProvider.save();

      // Disable vb authprovider
      //
      await N.models.users.AuthProvider.update({ _id: env.data.authProvider_vb._id }, {
        $set: { exists: false }
      });

      // Complete authentication using newly created authprovider
      //
      env.data.authProvider = authProvider;
    }
  });*/
};
