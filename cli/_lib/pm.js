// Convert private messages
//

'use strict';

const _             = require('lodash');
const mongoose      = require('mongoose');
const unserialize   = require('phpunserialize');
const memoize       = require('promise-memoize');
const html_unescape = require('nodeca.vbconvert/lib/html_unescape_entities');
const progress      = require('./utils').progress;

const BULK_SIZE = 200;


module.exports = async function (N) {
  const conn = await N.vbconvert.getConnection();


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


  // Import a single message from user A to user B into user A's dialog
  //
  async function import_message(pm, common_id, fromuserid, touserid, dialogs, batch) {
    let user1 = await get_user_by_hid(fromuserid);

    // don't import anything for non-existent user
    // (it still gets imported for the other side later)
    if (!user1) return;

    let user2 = (await get_user_by_hid(touserid)) ||
                { hid: touserid,   _id: new mongoose.Types.ObjectId('000000000000000000000000') };

    let key = `${user1.hid}_${user2.hid}`;

    let dialog = dialogs[key];

    if (!dialog) {
      dialog = await N.models.users.Dialog.findOne({ user: user1._id, to: user2._id }).lean(true);

      if (!dialog) {
        dialog = {
          _id:    new mongoose.Types.ObjectId(pm.dateline),
          user:   user1._id,
          to:     user2._id,
          unread: 0
        };
      }

      dialogs[key] = dialog;
    }

    let poster = user1.hid === pm.fromuserid ? user1 : user2;

    // mark sender of this message as an active user
    if (!poster.active && String(poster._id) !== '000000000000000000000000') {
      poster.active = true;

      await N.models.users.User.updateOne({ _id: poster._id }, { $set: { active: true } });
    }

    let params_id = await get_parser_param_id(
      poster.usergroups ? poster.usergroups : [ (await get_default_usergroup())._id ],
      pm.allowsmilie
    );

    let message_text = html_unescape(pm.message);

    let message = {
      _id:        new mongoose.Types.ObjectId(pm.dateline),
      common_id,
      ts:         new Date(pm.dateline * 1000),
      exists:     true,
      parent:     dialog._id,
      user:       poster._id,
      html:       '<p>' + _.escape(message_text) + '</p>',
      md:         message_text,
      params_ref: params_id,
      attach:     [] // an array in DB is required by parser
    };

    dialog.exists = true;
    dialog.cache = {
      last_message: message._id,
      last_user: message.user,
      last_ts: message.ts,
      preview: message_text
    };

    if (pm.messageread === 0) dialog.unread = (dialog.unread || 0) + 1;

    batch.messages.insert(message);
    batch.mappings.insert({
      pmid:      pm.pmid,
      to_user:   user1.hid === pm.userid ? user2.hid : user1.hid,
      pmtextid:  pm.pmtextid,
      common_id,
      message:   message._id,
      title:     pm.title,
      text:      message_text
    });
  }

  let pm_count = (await conn.query('SELECT count(*) AS total FROM pm'))[0][0].total;
  let bar = progress(' pm :current/:total :percent', pm_count);
  let last_pm_id = -1;

  for (;;) {
    let pms = (await conn.query(`
      SELECT pm.*, pmtext.*
      FROM pm JOIN pmtext USING(pmtextid)
      WHERE pmid > ?
      ORDER BY pmid ASC
      LIMIT ?
    `, [ last_pm_id, BULK_SIZE ]))[0];

    if (pms.length === 0) break;

    let existing_mappings = await N.models.vbconvert.PMMapping.find()
                                      .where('pmid').in(_.map(pms, 'pmid'))
                                      .select('pmid pmtextid common_id')
                                      .lean(true);

    // pmtext => common_id,
    // used to assign common_ids to other copies of the same message
    let pmtext_common_id = {};

    // pmid => Boolean,
    // used to check if message is imported
    //
    // note: multiple documents may exist with the same mysql id, but it's enough
    //       to check if one of them is present because of bulk inserts
    //       (two documents with the same pmid will be in the same bulk)
    let pmid_imported = {};

    for (let mapping of existing_mappings) {
      pmtext_common_id[mapping.pmtextid] = mapping.common_id;
      pmid_imported[mapping.pmid] = true;
    }

    let dialogs = {}; // `${user}_${to}` => Dialog

    let batches = {
      messages: N.models.users.DlgMessage.collection.initializeUnorderedBulkOp(),
      mappings: N.models.vbconvert.PMMapping.collection.initializeUnorderedBulkOp()
    };

    for (let pm of pms) {
      if (pmid_imported[pm.pmid]) continue;

      if (!pmtext_common_id[pm.pmtextid]) {
        pmtext_common_id[pm.pmtextid] = new mongoose.Types.ObjectId(pm.dateline);
      }

      let userid = pm.userid;
      let common_id = pmtext_common_id[pm.pmtextid];

      // Copy this message for each user;
      // if no users are listed, copy for each CC;
      // if no users are listed or CC'd, copy for each BCC
      //
      let to_users    = unserialize(pm.touserarray);
      let to_users_k  = _.without(Object.keys(to_users), 'cc', 'bcc');

      if (to_users_k.length === 0) {
        to_users_k = to_users_k.concat(Object.keys(to_users.cc || {}));
      }

      if (to_users_k.length === 0) {
        to_users_k = to_users_k.concat(Object.keys(to_users.bcc || {}));
      }

      let recipients;

      /* eslint-disable max-depth */
      // determine who user is communicating with (could be sender or recipient)
      if (+pm.fromuserid === userid) {
        recipients = to_users_k.map(Number);

        // a user sent pm to multiple people including herself, remove her from CC
        if (recipients.length > 1) {
          recipients = _.without(recipients, userid);
        }
      } else {
        recipients = [ +pm.fromuserid ];
      }

      // safeguard to ensure all messages are imported, shouldn't happen normally
      if (recipients.length === 0) {
        N.logger.warn('No recipients found for message=' + pm.pmid + ', ' + pm.touserarray);
      }

      for (let recipient of recipients) {
        await import_message(pm, common_id, userid, recipient, dialogs, batches);
      }
    }

    let bulk = N.models.users.Dialog.collection.initializeUnorderedBulkOp();

    for (let k of Object.keys(dialogs)) {
      let dialog = dialogs[k];

      bulk.find({
        _id:  dialog._id
      }).upsert().update({
        $set: dialog
      });
    }

    if (bulk.length > 0) await bulk.execute();

    await Promise.all(Object.keys(batches).map(name =>
      (batches[name].length > 0 ? batches[name].execute() : Promise.resolve())
    ));

    last_pm_id = pms[pms.length - 1].pmid;
    bar.tick(pms.length);
  }

  bar.terminate();

  get_user_by_hid.clear();
  get_default_usergroup.clear();
  get_parser_param_id.clear();
  conn.release();
  N.logger.info('PM import finished');
};
