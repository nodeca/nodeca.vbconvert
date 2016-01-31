// Import forum votes
//

'use strict';

const Promise   = require('bluebird');
const co        = require('co');
const mongoose  = require('mongoose');
const progress  = require('./utils').progress;
const POST      = 1; // content type for posts


module.exports = co.wrap(function* (N) {
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


  let rows = yield conn.query('SELECT count(*) AS count FROM votes');

  let bar = progress(' votes :current/:total [:bar] :percent', rows[0].count);

  let userids = yield conn.query(`
    SELECT fromuserid FROM votes
    GROUP BY fromuserid
    ORDER BY fromuserid ASC
  `);

  yield Promise.map(userids, co.wrap(function* (row) {
    // ignore votes casted by deleted users
    if (!users[row.fromuserid]) { return; }

    let rows = yield conn.query(`
      SELECT targetid,vote,fromuserid,touserid,date
      FROM votes
      WHERE fromuserid = ? AND contenttypeid = ?
    `, [ row.fromuserid, POST ]);

    let bulk = N.models.users.Vote.collection.initializeUnorderedBulkOp();
    let count = 0;

    for (var i = 0; i < rows; i++) {
      bar.tick();

      // ignore votes casted for deleted users
      if (!users[row.touserid]) { continue; }

      let post_mapping = yield N.models.vbconvert.PostMapping.findOne({
        mysql_id: row.targetid
      }).lean(true);

      count++;
      bulk.find({
        from:  users[row.fromuserid]._id,
        to:    users[row.touserid]._id,
        'for': post_mapping.post_id,
        type:  N.models.users.Vote.types.FORUM_POST
      }).upsert().update({
        $setOnInsert: {
          _id:   new mongoose.Types.ObjectId(row.date),
          from:  users[row.fromuserid]._id,
          to:    users[row.touserid]._id,
          'for': post_mapping.post_id,
          type:  N.models.users.Vote.types.FORUM_POST,
          hb:    users[row.fromuserid].hb,
          value: Number(row.vote)
        }
      });
    }

    if (!count) { return; }

    yield new Promise((resolve, reject) => {
      bulk.execute(err => err ? reject(err) : resolve());
    });
  }), { concurrency: 100 });

  bar.terminate();
  conn.release();
  N.logger.info('Vote import finished');
});
