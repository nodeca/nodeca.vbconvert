// Add information about who deleted topics/posts and why
//

'use strict';

const Promise  = require('bluebird');
const memoize  = require('promise-memoize');
const progress = require('./utils').progress;


module.exports = Promise.coroutine(function* (N) {
  let conn = yield N.vbconvert.getConnection();
  let rows, bar;

  const get_user_by_hid = memoize(function (hid) {
    return N.models.users.User.findOne({ hid }).lean(true);
  });

  //
  // Fetch deleted topics
  //

  rows = (yield conn.query(`
    SELECT primaryid,userid,reason
    FROM deletionlog
    WHERE type='thread'
  `))[0];

  bar = progress(' deleted topics :current/:total [:bar] :percent', rows.length);

  yield Promise.map(rows, Promise.coroutine(function* (row) {
    bar.tick();

    let user = yield get_user_by_hid(row.userid);

    if (!user) return;

    yield N.models.forum.Topic.update({ hid: row.primaryid }, {
      $set: {
        del_by:     user._id,
        del_reason: row.reason
      }
    });
  }), { concurrency: 100 });

  bar.terminate();

  //
  // Fetch deleted posts
  //

  rows = (yield conn.query(`
    SELECT primaryid,userid,reason
    FROM deletionlog
    WHERE type='post'
  `))[0];

  bar = progress(' deleted posts :current/:total [:bar] :percent', rows.length);

  yield Promise.map(rows, Promise.coroutine(function* (row) {
    bar.tick();

    let user = yield get_user_by_hid(row.userid);
    let post = yield N.models.vbconvert.PostMapping.findOne()
                         .where('mysql', row.primaryid)
                         .lean(true);

    if (!user) return;

    yield N.models.forum.Post.update({ _id: post.post_id }, {
      $set: {
        del_by:     user._id,
        del_reason: row.reason
      }
    });
  }), { concurrency: 100 });

  bar.terminate();

  get_user_by_hid.clear();
  conn.release();
  N.logger.info('Deletion log import finished');
});
