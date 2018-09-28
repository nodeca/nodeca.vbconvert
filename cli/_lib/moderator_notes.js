// Import moderator notes
//

'use strict';

const Promise       = require('bluebird');
const mongoose      = require('mongoose');
const html_unescape = require('nodeca.vbconvert/lib/html_unescape_entities');
const progress      = require('./utils').progress;
const options       = require('nodeca.users/server/users/mod_notes/_parse_options');


module.exports = async function (N) {
  const parse_bbcode = require('../../lib/parse_bbcode')(N);

  let conn = await N.vbconvert.getConnection();

  let rows = (await conn.query('SELECT * FROM usernote'))[0];

  let bar = progress(' mod notes :current/:total :percent', rows.length);

  // re-import all moderator notes from scratch every time
  await N.models.users.ModeratorNote.remove({});

  let bulk = N.models.users.ModeratorNote.collection.initializeOrderedBulkOp();
  let count = 0;

  await Promise.map(rows, async row => {
    bar.tick();

    let user   = await N.models.users.User.findOne({ hid: row.userid }).lean(true);
    let poster = await N.models.users.User.findOne({ hid: row.posterid }).lean(true);

    if (!user || !poster) return;

    let text;

    if (html_unescape(row.title) !== row.message) {
      text = html_unescape(row.title) + '\n\n' + row.message;
    } else {
      text = row.message;
    }

    let bbcode_data = [ {
      id:  row.usernoteid,
      text
    } ];

    let parsed_bbcode = (await parse_bbcode(bbcode_data))[0];

    let parsed_md = await N.parser.md2html({
      text: parsed_bbcode.md,
      options,
      attachments: []
    });

    count++;

    bulk.insert({
      _id:  new mongoose.Types.ObjectId(row.dateline),
      from: poster._id,
      to:   user._id,
      md:   parsed_bbcode.md,
      html: parsed_md.html,
      ts:   new Date(row.dateline * 1000)
    });
  }, { concurrency: 100 });

  if (count) await bulk.execute();

  bar.terminate();

  conn.release();
  N.logger.info('Moderator note import finished');
};
