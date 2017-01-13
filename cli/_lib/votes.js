// Import forum votes
//

'use strict';

const Promise   = require('bluebird');
const mongoose  = require('mongoose');
const progress  = require('./utils').progress;
const POST      = 1; // content type for posts


module.exports = Promise.coroutine(function* (N) {
  //
  // Establish MySQL connection
  //
  let conn = yield N.vbconvert.getConnection();

  //
  // Fetch all users
  //
  let users = {};

  (yield N.models.users.User.find().lean(true)).forEach(user => {
    users[user.hid] = user;
  });


  let rows = (yield conn.query('SELECT count(*) AS count FROM votes'))[0];

  let bar = progress(' votes :current/:total :percent', rows[0].count);

  let userids = (yield conn.query(`
    SELECT fromuserid FROM votes
    GROUP BY fromuserid
    ORDER BY fromuserid ASC
  `))[0];

  yield Promise.map(userids, Promise.coroutine(function* (userid_row) {
    let fromuserid = userid_row.fromuserid;

    // ignore votes casted by deleted users
    if (!users[fromuserid]) return;

    let rows = (yield conn.query(`
      SELECT targetid,vote,fromuserid,touserid,date
      FROM votes
      WHERE fromuserid = ? AND contenttypeid = ?
    `, [ fromuserid, POST ]))[0];

    let bulk = N.models.users.Vote.collection.initializeUnorderedBulkOp();
    let count = 0;

    for (let i = 0; i < rows.length; i++) {
      let row = rows[i];

      bar.tick();

      // ignore votes casted for deleted users
      if (!users[row.touserid]) continue;

      let post_mapping = yield N.models.vbconvert.PostMapping.findOne()
                                   .where('mysql', row.targetid)
                                   .lean(true);

      // voted for non-existent or not imported post
      if (!post_mapping) continue;

      count++;
      bulk.find({
        from:  users[row.fromuserid]._id,
        to:    users[row.touserid]._id,
        'for': post_mapping.post_id,
        type:  N.shared.content_type.FORUM_POST
      }).upsert().update({
        $setOnInsert: {
          _id:   new mongoose.Types.ObjectId(row.date),
          from:  users[row.fromuserid]._id,
          to:    users[row.touserid]._id,
          'for': post_mapping.post_id,
          type:  N.shared.content_type.FORUM_POST,
          hb:    users[row.fromuserid].hb,
          value: Number(row.vote)
        }
      });
    }

    if (!count) return;

    yield bulk.execute();
  }), { concurrency: 100 });

  bar.terminate();
  conn.release();
  N.logger.info('Vote import finished');
});
