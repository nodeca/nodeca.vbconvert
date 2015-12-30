// Log users in using old vb password
//

'use strict';


var crypto = require('crypto');


function md5(string) {
  return crypto.createHash('md5').update(string).digest('hex');
}


module.exports = function (N) {

  // Try to find auth data using `email_or_nick` as an email.
  //
  N.wire.on('server:users.auth.login.plain_exec', function find_vb_authlink_by_email(env, callback) {
    if (env.data.authLink) {
      // user already verified, nothing left to do
      callback();
      return;
    }

    if (env.data.user && env.data.authLink_vb) {
      callback();
      return;
    }

    N.models.users.AuthLink
        .findOne({
          email: env.params.email_or_nick,
          type: 'vb',
          exists: true
        })
        .exec(function (err, authLink) {

      if (err) {
        callback(err);
        return;
      }

      if (!authLink) {
        callback(); // There is no error - let next hooks do their job.
        return;
      }

      N.models.users.User
        .findOne({ _id: authLink.user_id })
        .lean(true)
        .exec(function (err, user) {

        if (err) {
          callback(err);
          return;
        }

        if (!user) {
          callback(); // There is no error - let next hooks do their job.
          return;
        }

        env.data.user        = user;
        env.data.authLink_vb = authLink;

        callback();
      });
    });
  });


  // Try to find auth data using `email_or_nick` as a nick.
  //
  N.wire.on('server:users.auth.login.plain_exec', function find_vb_authlink_by_nick(env, callback) {
    if (env.data.authLink) {
      // user already verified, nothing left to do
      callback();
      return;
    }

    if (env.data.user && env.data.authLink_vb) {
      callback();
      return;
    }

    N.models.users.User
        .findOne({ nick: env.params.email_or_nick })
        .lean(true)
        .exec(function (err, user) {

      if (err) {
        callback(err);
        return;
      }

      if (!user) {
        callback(); // There is no error - let next hooks do their job.
        return;
      }

      N.models.users.AuthLink
          .findOne({ user_id: user._id, type: 'vb', exists: true })
          .exec(function (err, authLink) {

        if (err) {
          callback(err);
          return;
        }

        if (!authLink) {
          callback(); // There is no error - let next hooks do their job.
          return;
        }

        env.data.user        = user;
        env.data.authLink_vb = authLink;

        callback();
      });
    });
  });


  // Try to login using vb authlink
  //
  N.wire.on('server:users.auth.login.plain_exec', function verify_vb_authlink(env) {
    if (!env.data.user || !env.data.authLink_vb) {
      return;
    }

    // trim and convert non-ascii ucs-2 characters to html entities
    var pass = env.params.pass.trim().split('').map(function (x) {
      return x.charCodeAt(0) > 255 ? '&#' + x.charCodeAt(0) + ';' : x;
    }).join('');

    if (env.data.authLink_vb.meta.pass === md5(md5(pass) + env.data.authLink_vb.meta.salt)) {
      env.data.authLink = env.data.authLink_vb;
    }
  });
};
