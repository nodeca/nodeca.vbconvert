// Convert users
//

'use strict';

const Promise        = require('bluebird');
const mongoose       = require('mongoose');
const html_unescape  = require('nodeca.vbconvert/lib/html_unescape_entities');
const nick_transform = require('nodeca.vbconvert/lib/nick_transform');
const progress       = require('./utils').progress;

const UNCONFIRMED = 3;
const MEMBERS     = 11;
const VIOLATORS   = 12;


module.exports = async function (N) {
  let bot = await N.models.users.User.findOne()
                      .where('hid').equals(N.config.bots.default_bot_hid)
                      .lean(true);

  let usergroups = await N.models.vbconvert.UserGroupMapping.find().lean(true);

  let mongoid = {};

  usergroups.forEach(function (usergroup) {
    mongoid[usergroup.mysql] = usergroup.mongo;
  });

  let conn = await N.vbconvert.getConnection();

  let rows = (await conn.query('SELECT userid, username FROM user ORDER BY userid ASC'))[0];
  let username_mapping = {};
  let nicks_seen = new Set(rows.map(row => nick_transform.normalize(row.username)));

  for (let { userid, username } of rows) {
    let nick = html_unescape(username);

    if (!nick_transform.valid(nick)) {
      username_mapping[userid] = nick_transform(nick, nicks_seen, nick_transform.rules);
    }
  }

  N.logger.info('Username mapping created ' +
    `(changing ${Object.keys(username_mapping).length} out of ${rows.length} nicknames)`);

  // remove old records of name change in case import is restarted
  await N.models.users.UserNickChange.deleteMany({});

  let gi_rows = (await conn.query('SELECT value FROM setting WHERE varname = "globalignore" LIMIT 1'))[0];

  let hellbanned_ids = [];

  if (gi_rows.length) {
    hellbanned_ids = gi_rows[0].value.split(' ').map(Number);
  }

  rows = (await conn.query(`
    SELECT userid,usergroupid,membergroupids,username,email,password,salt,
           passworddate,ipaddress,joindate,lastactivity,icq,skype,
           CAST(birthday_search as char) as birthday,
           field5 as firstname,field6 as lastname
    FROM user JOIN userfield USING(userid)
    ORDER BY userid ASC
  `))[0];

  let bar = progress(' users :current/:total :percent', rows.length);

  await Promise.map(rows, async row => {
    bar.tick();

    // don't import admin (hid=1, it's now a bot)
    if (row.userid === N.config.bots.default_bot_hid) return;

    let user = await N.models.users.User.findOne({ hid: row.userid }).lean(false);

    if (!user) {
      user = new N.models.users.User({
        _id: new mongoose.Types.ObjectId(row.joindate)
      });
    }

    user.hid            = row.userid;
    user.nick           = username_mapping[row.userid] || html_unescape(row.username);
    user.email          = row.email;
    user.joined_ts      = new Date(row.joindate * 1000);
    user.joined_ip      = row.ipaddress;
    user.last_active_ts = new Date(row.lastactivity * 1000);
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

      let result = (await conn.query(`
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

    await user.save();

    if (username_mapping[row.userid]) {
      await new N.models.users.UserNickChange({
        from:     bot._id,
        user:     user._id,
        old_nick: html_unescape(row.username),
        new_nick: username_mapping[row.userid]
      }).save();
    }

    let authProvider = new N.models.users.AuthProvider();

    authProvider.user    = user._id;
    authProvider.type    = 'vb';
    authProvider.email   = row.email;
    authProvider.ts      = new Date(row.passworddate);
    authProvider.last_ts = new Date(row.passworddate);
    authProvider.ip      = row.ipaddress;
    authProvider.last_ip = row.ipaddress;
    authProvider._id     = new mongoose.Types.ObjectId(authProvider.ts / 1000);
    authProvider.meta    = {
      pass: row.password,
      salt: row.salt
    };

    await authProvider.save();
  }, { concurrency: 100 });

  bar.terminate();

  await N.models.core.Increment.updateOne(
          { key: 'user' },
          { $set: { value: rows[rows.length - 1].userid } },
          { upsert: true }
        );

  conn.release();
  N.logger.info('User import finished');
};
