'use strict';


const randomBytes = require('crypto').randomBytes;
const co          = require('bluebird-co').co;
const crypto      = require('crypto');


function md5(string) {
  return crypto.createHash('md5').update(string).digest('hex');
}


describe('Login', function () {
  let login = randomBytes(10).toString('hex');
  let email = login + '@example.com';
  let password = randomBytes(10).toString('hex') + 'Abc123';
  let user;


  // Create new user with vb authlink
  //
  before(co.wrap(function* () {
    user = new TEST.N.models.users.User({
      nick: login
    });

    yield user.save();

    let authLink = new TEST.N.models.users.AuthLink({
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

    yield authLink.save();
  }));


  it('should authorize with vb authlink', function (done) {
    TEST.browser
      .do.auth()
      .do.open(TEST.N.router.linkTo('users.auth.login.show'))
      .do.fill('form[data-on-submit="users.auth.login.plain_exec"]', {
        email_or_nick: login,
        pass: password
      })
      .do.click('button[type="submit"]')
      .do.wait('.user-member-page')
      .test.evaluate(function (user_id) {
        /* global $ */
        return JSON.parse($('#runtime').text()).user_id === user_id;
      }, String(user._id))
      .run(true, done);
  });
});
