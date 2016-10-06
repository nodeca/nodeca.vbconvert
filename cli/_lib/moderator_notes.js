// Import moderator notes
//

'use strict';

const Promise       = require('bluebird');
const mongoose      = require('mongoose');
const html_unescape = require('./utils').html_unescape;
const progress      = require('./utils').progress;
const options       = require('nodeca.users/server/users/mod_notes/_parse_options');


module.exports = Promise.coroutine(function* (N) {
  const parse_bbcode = require('../../lib/parse_bbcode')(N);

  let conn = yield N.vbconvert.getConnection();

  let rows = (yield conn.query('SELECT * FROM usernote'))[0];

  let bar = progress(' mod notes :current/:total [:bar] :percent', rows.length);

  // re-import all moderator notes from scratch every time
  yield N.models.users.ModeratorNote.remove({});

  let bulk = N.models.users.ModeratorNote.collection.initializeOrderedBulkOp();
  let count = 0;

  yield Promise.map(rows, Promise.coroutine(function* (row) {
    bar.tick();

    let user   = yield N.models.users.User.findOne({ hid: row.userid }).lean(true);
    let poster = yield N.models.users.User.findOne({ hid: row.posterid }).lean(true);

    if (!user || !poster) return;

    let text;

    if (html_unescape(row.title) !== row.message) {
      text = html_unescape(row.title) + '\n\n' + row.message;
    } else {
      text = row.message;
    }

    let bbcode_data = [ {
      id:          row.usernoteid,
      text,
      options,
      attachments: []
    } ];

    let parsed = yield parse_bbcode(bbcode_data);

    count++;

    bulk.insert({
      _id:  new mongoose.Types.ObjectId(row.dateline),
      from: poster._id,
      to:   user._id,
      md:   parsed[0].md,
      html: parsed[0].html,
      ts:   new Date(row.dateline * 1000)
    });
  }), { concurrency: 100 });

  if (count) yield bulk.execute();

  bar.terminate();

  conn.release();
  N.logger.info('Moderator note import finished');
});
