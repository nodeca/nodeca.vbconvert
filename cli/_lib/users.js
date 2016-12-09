// Convert users
//

'use strict';

const Promise       = require('bluebird');
const mongoose      = require('mongoose');
const progress      = require('./utils').progress;
const html_unescape = require('./utils').html_unescape;

const UNCONFIRMED = 3;
const MEMBERS     = 11;
const VIOLATORS   = 12;


module.exports = Promise.coroutine(function* (N) {
  let usergroups = yield N.models.vbconvert.UserGroupMapping.find().lean(true);

  let mongoid = {};

  usergroups.forEach(function (usergroup) {
    mongoid[usergroup.mysql] = usergroup.mongo;
  });

  let conn = yield N.vbconvert.getConnection();

  let gi_rows = (yield conn.query('SELECT value FROM setting WHERE varname = "globalignore" LIMIT 1'))[0];

  let hellbanned_ids = [];

  if (gi_rows.length) {
    hellbanned_ids = gi_rows[0].value.split(' ').map(Number);
  }

  let rows = (yield conn.query(`
    SELECT userid,usergroupid,membergroupids,username,email,password,salt,
           passworddate,ipaddress,joindate,lastactivity,posts,icq,skype,
           CAST(birthday_search as char) as birthday,
           field5 as firstname,field6 as lastname
    FROM user JOIN userfield USING(userid)
    ORDER BY userid ASC
  `))[0];

  let bar = progress(' users :current/:total :percent', rows.length);

  yield Promise.map(rows, Promise.coroutine(function* (row) {
    bar.tick();

    let user = yield N.models.users.User.findOne({ hid: row.userid }).lean(false);

    if (!user) {
      user = new N.models.users.User({
        _id: new mongoose.Types.ObjectId(row.joindate)
      });
    }

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
    user.about          = {};

    // force users to resubmit birthday and location
    user.incomplete_profile = true;

    if (row.icq && Number(row.icq)) user.about.icq = row.icq;
    if (row.skype) user.about.skype = row.skype;

    if (row.usergroupid === UNCONFIRMED) {
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

      // replace this usergroup with members
      user.usergroups.push(mongoid[MEMBERS]);

    } else if (row.usergroupid === VIOLATORS) {
      // for violators: fetch old usergroup before ban, and add it as well
      user.usergroups.push(mongoid[row.usergroupid]);

      let result = (yield conn.query(`
        SELECT usergroupid FROM userban WHERE userid = ?
      `, [ row.userid ]))[0];
      let ban = (result || [])[0];

      if (ban.usergroupid && mongoid[ban.usergroupid]) {
        user.usergroups.push(mongoid[ban.usergroupid]);
      } else {
        user.usergroups.push(mongoid[MEMBERS]);
      }

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
