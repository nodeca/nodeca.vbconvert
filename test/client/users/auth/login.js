'use strict';


const crypto      = require('crypto');
const randomBytes = require('crypto').randomBytes;


function md5(string) {
  return crypto.createHash('md5').update(string).digest('hex');
}


describe('Login', function () {
  let login = randomBytes(10).toString('hex');
  let email = login + '@example.com';
  let password = randomBytes(10).toString('hex') + 'Abc123';
  let user;


  // Create new user with vb authprovider
  //
  before(async () => {
    user = new TEST.N.models.users.User({
      nick: login
    });

    await user.save();

    let authProvider = new TEST.N.models.users.AuthProvider({
      type: 'vb',
      email,
      user: user._id,
      meta: {
        salt: 'abc',
        pass: md5(md5(password) + 'abc')
      },
      ip: '127.0.0.1',
      last_ip: '127.0.0.1'
    });

    await authProvider.save();
  });


  it('should authorize with vb authprovider', function (done) {
    TEST.browser
      .do.auth()
      .do.open(TEST.N.router.linkTo('users.auth.login.show'))
      .do.fill('form[data-on-submit="users.auth.login.plain_exec"]', {
        email_or_nick: login,
        pass: password
      })
      .do.click('form[data-on-submit="users.auth.login.plain_exec"] button[type="submit"]')
      .do.wait('.user-member-page')
      .test.evaluate(function (user_id) {
        /* global $ */
        return JSON.parse($('#runtime').text()).user_id === user_id;
      }, String(user._id))
      .run(true, done);
  });
});
