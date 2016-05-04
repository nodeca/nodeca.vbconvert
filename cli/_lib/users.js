// Convert users
//

'use strict';

const Promise       = require('bluebird');
const co            = require('co');
const mongoose      = require('mongoose');
const progress      = require('./utils').progress;
const html_unescape = require('./utils').html_unescape;


module.exports = co.wrap(function* (N) {
  let usergroups = yield N.models.vbconvert.UserGroupMapping.find().lean(true);

  let mongoid = {};

  usergroups.forEach(function (usergroup) {
    mongoid[usergroup.mysql] = usergroup.mongo;
  });

  let conn = yield N.vbconvert.getConnection();

  let gi_rows = yield conn.query('SELECT value FROM setting WHERE varname = "globalignore" LIMIT 1');

  let hellbanned_ids = [];

  if (gi_rows.length) {
    hellbanned_ids = gi_rows[0].value.split(' ').map(Number);
  }

  let rows = yield conn.query(`
    SELECT userid,usergroupid,membergroupids,username,email,
           password,salt,passworddate,ipaddress,joindate,lastactivity,posts,
           field5 as firstname,field6 as lastname
    FROM user JOIN userfield USING(userid)
    ORDER BY userid ASC
  `);

  let bar = progress(' users :current/:total [:bar] :percent', rows.length);

  yield Promise.map(rows, co.wrap(function* (row) {
    bar.tick();

    if (yield N.models.users.User.findOne({ hid: row.userid }).lean(true)) {
      // user with this id is already imported
      return;
    }

    let user = new N.models.users.User();

    user._id            = new mongoose.Types.ObjectId(row.joindate);
    user.hid            = row.userid;
    user.nick           = html_unescape(row.username);
    user.email          = row.email;
    user.joined_ts      = new Date(row.joindate * 1000);
    user.joined_ip      = row.ipaddress;
    user.last_active_ts = new Date(row.lastactivity * 1000);
    user.post_count     = row.posts;
    user.first_name     = html_unescape(row.firstname);
    user.last_name      = html_unescape(row.lastname);
    user.usergroups     = [];

    if (row.usergroupid === 3) {
      // Process users with unconfirmed email:
      //
      //  - there are 25 users with old ids (< 200k) with forum messages,
      //    which we're moving to "members" group
      //
      //  - the rest are users with new ids that we can just remove
      //
      if (row.userid > 200000) {
        return;
      }

      // replace usergroup 3 with usergroup 2 (mapped to members)
      user.usergroups.push(mongoid[2]);

    } else if (mongoid[row.usergroupid]) {
      user.usergroups.push(mongoid[row.usergroupid]);
    }

    if (row.membergroupids) {
      user.usergroups = user.usergroups.concat(row.membergroupids.split(',').map(function (id) {
        return mongoid[id];
      }).filter(Boolean));
    }

    if (user.usergroups.length === 0) {
      N.logger.warn('User has no usergroups: ' + row.userid);
    }

    if (hellbanned_ids.indexOf(row.userid) !== -1) {
      user.hb = true;
    }

    yield user.save();

    let authLink = new N.models.users.AuthLink();

    authLink.user    = user._id;
    authLink.type    = 'vb';
    authLink.email   = row.email;
    authLink.ts      = new Date(row.passworddate);
    authLink.last_ts = new Date(row.passworddate);
    authLink.ip      = row.ipaddress;
    authLink.last_ip = row.ipaddress;
    authLink._id     = new mongoose.Types.ObjectId(authLink.ts / 1000);
    authLink.meta    = {
      pass: row.password,
      salt: row.salt
    };

    yield authLink.save();
  }), { concurrency: 100 });

  bar.terminate();

  yield N.models.core.Increment.update(
          { key: 'user' },
          { $set: { value: rows[rows.length - 1].userid } },
          { upsert: true }
        );

  conn.release();
  N.logger.info('User import finished');
});
