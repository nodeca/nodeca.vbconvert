// Convert private messages
//

'use strict';

const _             = require('lodash');
const Promise       = require('bluebird');
const mongoose      = require('mongoose');
const unserialize   = require('phpunserialize');
const memoize       = require('promise-memoize');
const html_unescape = require('./utils').html_unescape;
const progress      = require('./utils').progress;


module.exports = Promise.coroutine(function* (N) {
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


  // Fetch all dialogs and return dialog chains (array of arrays). Note that
  // each dialog chain can include multiple users (CC's, BCC's), so each
  // chain will need to be split later.
  //
  // Return value (each subarray contains ids of dialogs related to each other):
  // [ [ pmid, pmid, pmid, ... ], [ pmid, pmid, pmid, ... ], ... ]
  //
  const link_dialog_messages = Promise.coroutine(function* () {
    // TODO: this function consumes a lot of memory, check a way to improve this
    let all_pms = (yield conn.query('SELECT pmid,pmtextid,parentpmid FROM pm ORDER BY pmid ASC'))[0];
    let linked_pms = {};
    let pm_by_parent = {};
    let pm_by_text = {};
    let pm_by_id = _.keyBy(all_pms, 'pmid');
    let result = [];

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

    all_pms.forEach(root_pm => {
      if (linked_pms[root_pm.pmid]) return;

      let chain = [];

      get_relative(root_pm).forEach(pm => {
        linked_pms[pm.pmid] = true;
        chain.push(pm.pmid);
      });

      result.push(chain.sort());
    });

    return result;
  });


  // Process dialog owned by user `fromuserid` with `touserid`,
  // starting with a message `root_pm`.
  //
  /* eslint-disable max-depth */
  const import_dialog = Promise.coroutine(function* (pms, root_pm, fromuserid, touserid, data) {
    // check if it's imported previously in this run
    for (let mapping of data.mappings) {
      if (mapping.mysql === root_pm.pmid && mapping.to_user === touserid) {
        return;
      }
    }

    let user1 = (yield get_user_by_hid(fromuserid)) ||
                { hid: fromuserid, _id: new mongoose.Types.ObjectId('000000000000000000000000') };
    let user2 = (yield get_user_by_hid(touserid)) ||
                { hid: touserid,   _id: new mongoose.Types.ObjectId('000000000000000000000000') };

    let dialog = {
      _id:       new mongoose.Types.ObjectId(root_pm.dateline),
      common_id: new mongoose.Types.ObjectId(root_pm.dateline),
      title:     html_unescape(root_pm.title),
      user:      user1._id,
      to:        user2._id,
      exists:    true,
      unread:    0
    };

    data.dialogs.push(dialog);

    for (let pm of pms) {
      // check if they have the same title (break the chain otherwise)
      if (pm.title.replace(/^Re:/, '').trim() !==
          root_pm.title.replace(/^Re:/, '').trim()) {
        continue;
      }

      // if dialog was already imported before for another user,
      // get common_id from there
      if (pm.userid === touserid) {
        for (let mapping of data.mappings) {
          if (mapping.mysql === pm.pmid && mapping.to_user === fromuserid) {
            dialog.common_id = mapping.dialog;
          }
        }
      }

      if (pm.userid !== fromuserid) {
        continue;
      }

      let to_users = unserialize(pm.touserarray);

      // check that other party is either sender or recipient of this message
      if (!(touserid === pm.fromuserid ||
            to_users[touserid] ||
            (to_users.cc && to_users.cc[touserid]) ||
            (to_users.bcc && to_users.bcc[touserid]) ||
            !touserid)) {
        continue;
      }

      let poster = user1.hid === pm.fromuserid ? user1 : user2;

      // mark sender of this message as an active user
      if (!poster.active) {
        poster.active = true;

        yield N.models.users.User.update({ _id: poster._id }, { $set: { active: true } });
      }

      let params_id = yield get_parser_param_id(
        poster.usergroups ? poster.usergroups : [ (yield get_default_usergroup())._id ],
        pm.allowsmilie
      );

      let message_text = html_unescape(pm.message);

      let message = {
        _id:        new mongoose.Types.ObjectId(pm.dateline),
        ts:         new Date(pm.dateline * 1000),
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

      data.messages.push(message);
      data.mappings.push({
        mysql:   pm.pmid,
        to_user: user1.hid === pm.userid ? user2.hid : user1.hid,
        dialog:  dialog.common_id,
        message: message._id,
        text:    message_text
      });
    }
  });

  let dialog_chains = yield link_dialog_messages();
  let pm_count = (yield conn.query('SELECT count(*) AS total FROM pm'))[0][0].total;
  let bar = progress(' pm :current/:total :percent', pm_count);

  // dialogs in different chains are guaranteed to be in different dialogs,
  // so we can import chains in parallel
  yield Promise.map(dialog_chains, Promise.coroutine(function* (chain) {
    // if first message is imported, we can assume the rest is imported also
    if (yield N.models.vbconvert.PMMapping.findOne({ mysql: chain[0] }).lean(true)) {
      return;
    }

    let data = {
      dialogs: [],
      messages: [],
      mappings: []
    };

    let pms = (yield conn.query(`
      SELECT pm.*, pmtext.*
      FROM pm JOIN pmtext USING(pmtextid)
      WHERE pmid IN (${chain.join(',')})
      ORDER BY pmid ASC
    `))[0];

    for (let root_pm of pms) {
      bar.tick();

      let userid = root_pm.userid;

      // Copy this message for each user;
      // if no users are listed, copy for each CC;
      // if no users are listed or CC'd, copy for each BCC
      //
      let to_users    = unserialize(root_pm.touserarray);
      let to_users_k  = _.without(Object.keys(to_users), 'cc', 'bcc');

      if (to_users_k.length === 0) {
        to_users_k = to_users_k.concat(Object.keys(to_users.cc || {}));
      }

      if (to_users_k.length === 0) {
        to_users_k = to_users_k.concat(Object.keys(to_users.bcc || {}));
      }

      let recipients;

      // determine who user is communicating with (could be sender or recipient)
      if (+root_pm.fromuserid === userid) {
        recipients = to_users_k.map(Number);

        // a user sent pm to multiple people including herself, remove her from CC
        if (recipients.length > 1) {
          recipients = _.without(recipients, userid);
        }
      } else {
        recipients = [ +root_pm.fromuserid ];
      }

      // safeguard to ensure all messages are imported, shouldn't happen normally
      if (recipients.length === 0) {
        N.logger.warn('No recipients found for message=' + root_pm.pmid + ', ' + root_pm.touserarray);
      }

      for (let recipient of recipients) {
        yield import_dialog(pms, root_pm, userid, recipient, data);
      }
    }

    // Bulk-insert items from a single dialog chain.
    //
    // Note that in case convertor fails there will be no data loss,
    // but some dialogs may be imported twice.
    //
    if (data.dialogs.length > 0) {
      let bulk;

      bulk = N.models.users.Dialog.collection.initializeOrderedBulkOp();
      data.dialogs.forEach(d => { bulk.insert(d); });
      yield bulk.execute();

      bulk = N.models.users.DlgMessage.collection.initializeOrderedBulkOp();
      data.messages.forEach(d => { bulk.insert(d); });
      yield bulk.execute();

      bulk = N.models.vbconvert.PMMapping.collection.initializeOrderedBulkOp();
      data.mappings.forEach(d => { bulk.insert(d); });
      yield bulk.execute();
    }
  }), { concurrency: 100 });

  bar.terminate();

  get_user_by_hid.clear();
  get_default_usergroup.clear();
  get_parser_param_id.clear();
  conn.release();
  N.logger.info('PM import finished');
});
