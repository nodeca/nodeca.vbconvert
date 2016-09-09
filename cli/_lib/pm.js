// Convert private messages
//

'use strict';

const _             = require('lodash');
const Promise       = require('bluebird');
const co            = require('bluebird-co').co;
const mongoose      = require('mongoose');
const unserialize   = require('phpunserialize');
const memoize       = require('promise-memoize');
const html_unescape = require('./utils').html_unescape;
const progress      = require('./utils').progress;


module.exports = co.wrap(function* (N) {
  const conn = yield N.vbconvert.getConnection();


  const get_user_by_hid = memoize(function (hid) {
    return N.models.users.User.findOne({ hid }).lean(true);
  });


  const get_default_usergroup = memoize(function () {
    return N.models.users.UserGroup.findOne({ short_name: 'members' }).lean(true);
  });


  const get_parser_param_id = memoize(function (usergroup_ids, allowsmilie) {
    return N.settings.getByCategory(
      'dialogs_markup',
      { usergroup_ids },
      { alias: true }
    ).then(params => {
      // make sure quotes are not collapsed in imported messages
      params.quote_collapse = false;

      if (!allowsmilie) {
        params.emoji = false;
      }

      return N.models.core.MessageParams.setParams(params);
    });
  });


  let all_pms = (yield conn.query('SELECT pmid,userid,pmtextid,parentpmid,messageread FROM pm ORDER BY pmid ASC'))[0]
                  .map(p => ({
                    pmid:        p.pmid,
                    userid:      p.userid,
                    pmtextid:    p.pmtextid,
                    parentpmid:  p.parentpmid,
                    messageread: p.messageread,
                    dialogids:   {}
                  }));
  let pm_by_parent = {};
  let pm_by_text = {};
  let pm_by_user = {};
  let pm_by_id = _.keyBy(all_pms, 'pmid');

  all_pms.forEach(pm => {
    let parentid = pm.parentpmid;

    if (parentid !== 0) {
      pm_by_parent[parentid] = pm_by_parent[parentid] || [];
      pm_by_parent[parentid].push(pm);
    }
  });

  all_pms.forEach(pm => {
    let textid = pm.pmtextid;

    pm_by_text[textid] = pm_by_text[textid] || [];
    pm_by_text[textid].push(pm);
  });

  all_pms.forEach(pm => {
    let userid = pm.userid;

    pm_by_user[userid] = pm_by_user[userid] || [];
    pm_by_user[userid].push(pm);
  });


  // Find all posts in the same thread as the current one
  //
  function get_relative(root_pm, acc) {
    acc = acc || [ root_pm ];

    // Assume another post is related to current one if either:
    //
    //  1. pmtextid is the same (two copies of the same text)
    //  2. parentpmid matches pmid (child)
    //  3. pmid matches parentpmid (parent)
    //  4. parentpmid matches parentpmid (siblings)
    //
    let found = [].concat(pm_by_text[root_pm.pmtextid] || [])
                  .concat(pm_by_parent[root_pm.pmid] || []);

    if (root_pm.parentpmid) {
      found = found.concat(pm_by_parent[root_pm.parentpmid] || []);

      if (pm_by_id[root_pm.parentpmid]) {
        found.push(pm_by_id[root_pm.parentpmid]);
      }
    }

    for (let i = 0; i < found.length; i++) {
      let pm = found[i];

      if (_.findIndex(acc, p => p.pmid === pm.pmid) !== -1) continue;

      acc.push(pm);

      acc = get_relative(pm, acc);
    }

    return acc;
  }

  // Process dialog owned by user `fromuserid` with `touserid`,
  // starting with a message `root_pm`.
  //
  const import_dialog = co.wrap(function* (root_pm, fromuserid, touserid, result) {
    let pms       = get_relative(root_pm).sort((a, b) => a.pmid - b.pmid);
    let pmtextids = _.map(pms, 'pmtextid');
    let texts     = _.keyBy(
      (yield conn.query(`
        SELECT * FROM pmtext
        WHERE pmtextid IN (${pmtextids.map(Number).join(',')})
      `))[0],
      'pmtextid'
    );
    let user1     = (yield get_user_by_hid(fromuserid)) ||
                    { hid: fromuserid, _id: new mongoose.Types.ObjectId('000000000000000000000000') };
    let user2     = (yield get_user_by_hid(touserid)) ||
                    { hid: touserid,   _id: new mongoose.Types.ObjectId('000000000000000000000000') };

    let dialog = {
      _id:       new mongoose.Types.ObjectId(texts[root_pm.pmtextid].dateline),
      common_id: new mongoose.Types.ObjectId(texts[root_pm.pmtextid].dateline),
      title:     html_unescape(texts[root_pm.pmtextid].title),
      user:      user1._id,
      to:        user2._id,
      exists:    true,
      unread:    0
    };

    result.dialogs.push(dialog);

    // check if dialog was already imported before for another user,
    // get common_id if that's the case
    for (let pm of pms) {
      if (pm.dialogids[fromuserid]) {
        dialog.common_id = pm.dialogids[fromuserid];
      }
    }

    for (let pm of pms) {
      if (!texts[pm.pmtextid]) continue;
      if (pm.userid !== fromuserid) continue;

      // check if they have the same title (break the chain otherwise)
      if (texts[pm.pmtextid].title.replace(/^Re:/, '').trim() !==
          texts[root_pm.pmtextid].title.replace(/^Re:/, '').trim()) {
        continue;
      }

      let poster = user1.hid === texts[pm.pmtextid].fromuserid ? user1 : user2;

      let params_id = yield get_parser_param_id(
        poster.usergroups ? poster.usergroups : [ (yield get_default_usergroup())._id ],
        texts[pm.pmtextid].allowsmilie
      );

      let message_text = html_unescape(texts[pm.pmtextid].message);

      let message = {
        _id:        new mongoose.Types.ObjectId(texts[pm.pmtextid].dateline),
        ts:         new Date(texts[pm.pmtextid].dateline * 1000),
        exists:     true,
        parent:     dialog._id,
        user:       poster._id,
        html:       '<p>' + _.escape(message_text) + '</p>',
        md:         message_text,
        params_ref: params_id,
        attach:     [] // an array in DB is required by parser
      };

      dialog.cache = {
        last_message: message._id,
        last_user: message.user,
        last_ts: message.ts,
        preview: message_text
      };

      if (pm.messageread === 0) dialog.unread++;

      pm.dialogids[touserid] = dialog.common_id;

      result.messages.push(message);
      result.map.push({
        mysql:   pm.pmid,
        to_user: user1.hid === pm.userid ? user2.hid : user1.hid,
        dialog:  dialog.common_id,
        message: message._id,
        text:    message_text
      });
    }
  });

  let bar = progress(' pm :current/:total [:bar] :percent', all_pms.length);

  let old_maps = yield N.models.vbconvert.PMMapping.find().lean(true);

  old_maps.forEach(m => {
    pm_by_id[m.mysql].dialogids[m.to_user] = m.dialog;
  });

  // it'll be no longer used, so clean up memory a bit
  all_pms = null;
  old_maps = null;

  yield Promise.map(Object.keys(pm_by_user), co.wrap(function* (userid) {
    userid = +userid;

    for (let root_pm of pm_by_user[userid]) {
      bar.tick();

      let root_pmtext = (yield conn.query(`
        SELECT * FROM pmtext WHERE pmtextid = ?
      `, [ root_pm.pmtextid ]))[0][0];

      if (!root_pmtext) {
        // message exists, but message text doesn't; skip those
        continue;
      }

      // Copy this message for each user;
      // if no users are listed, copy for each CC;
      // if no users are listed or CC'd, copy for each BCC
      //
      let to_users    = unserialize(root_pmtext.touserarray);
      let to_users_k  = _.without(Object.keys(to_users), 'cc', 'bcc');

      if (to_users_k.length === 0) {
        to_users_k = to_users_k.concat(Object.keys(to_users.cc || {}));
      }

      if (to_users_k.length === 0) {
        to_users_k = to_users_k.concat(Object.keys(to_users.bcc || {}));
      }

      let recipients;

      // determine who user is communicating with (could be sender or recipient)
      if (+root_pmtext.fromuserid === userid) {
        recipients = to_users_k.map(Number);

        // a user sent pm to multiple people including herself, remove her from CC
        if (recipients.length > 1) {
          recipients = _.without(recipients, userid);
        }
      } else {
        recipients = [ +root_pmtext.fromuserid ];
      }

      // safeguard to ensure all messages are imported, shouldn't happen normally
      if (recipients.length === 0) {
        N.logger.warn('No recipients found for message=' + root_pm.pmid + ', ' + root_pmtext.touserarray);
      }

      let data = {
        dialogs: [],
        messages: [],
        map: []
      };

      for (let user of recipients) {
        // check if already imported
        if (root_pm.dialogids[user]) continue;

        yield import_dialog(root_pm, userid, user, data);
      }

      if (data.dialogs.length > 0) {
        let bulk;

        bulk = N.models.users.Dialog.collection.initializeOrderedBulkOp();
        data.dialogs.forEach(d => { bulk.insert(d); });
        yield bulk.execute();

        bulk = N.models.users.DlgMessage.collection.initializeOrderedBulkOp();
        data.messages.forEach(d => { bulk.insert(d); });
        yield bulk.execute();

        bulk = N.models.vbconvert.PMMapping.collection.initializeOrderedBulkOp();
        data.map.forEach(d => { bulk.insert(d); });
        yield bulk.execute();
      }
    }
  }), { concurrency: 100 });

  bar.terminate();

  get_user_by_hid.clear();
  get_default_usergroup.clear();
  get_parser_param_id.clear();
  conn.release();
  N.logger.info('PM import finished');
});
