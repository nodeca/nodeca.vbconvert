// Import subscriptions to topics and sections
//

'use strict';

const Promise  = require('bluebird');
const co       = require('bluebird-co').co;
const memoize  = require('promise-memoize');
const progress = require('./utils').progress;


module.exports = co.wrap(function* (N) {
  let conn = yield N.vbconvert.getConnection();
  let rows, bar;

  const get_user_by_hid = memoize(function (hid) {
    return N.models.users.User.findOne({ hid }).lean(true);
  });

  //
  // Section subscriptions
  //

  rows = yield conn.query(`
    SELECT userid,forumid,emailupdate
    FROM subscribeforum
    ORDER BY subscribeforumid ASC
  `);

  bar = progress(' section subscriptions :current/:total [:bar] :percent', rows.length);

  let bulk = N.models.users.Subscription.collection.initializeUnorderedBulkOp();
  let count = 0;

  yield Promise.map(rows, co.wrap(function* (row) {
    bar.tick();

    let user = yield get_user_by_hid(row.userid);

    if (!user) return;

    let section = yield N.models.forum.Section.findOne()
                                              .where('hid', row.forumid)
                                              .select('_id')
                                              .lean(true);

    if (!section) return;

    // in the old forum, 0 means no emails are sent, 1 means emails are sent
    // for every message, 2 and 3 are daily/weekly digests
    let type = row.emailupdate === 1 ? 'WATCHING' : 'TRACKING';

    count++;
    bulk.find({
      user:  user._id,
      to:    section._id
    }).upsert().update({
      $setOnInsert: {
        user:    user._id,
        to:      section._id,
        to_type: N.models.users.Subscription.to_types.FORUM_SECTION,
        type:    N.models.users.Subscription.types[type]
      }
    });
  }), { concurrency: 100 });

  if (count) yield bulk.execute();

  bar.terminate();

  //
  // Topic subscriptions
  //
  // For each user we bulk-insert all her subscriptions
  //

  rows = yield conn.query(`
    SELECT primaryid,userid,reason
    FROM deletionlog
    WHERE type='post'
  `);

  rows = yield conn.query('SELECT count(*) AS count FROM subscribethread');

  bar = progress(' topic subscriptions :current/:total [:bar] :percent', rows[0].count);

  let userids = yield conn.query(`
    SELECT userid FROM subscribethread
    GROUP BY userid
    ORDER BY userid ASC
  `);

  yield Promise.map(userids, co.wrap(function* (userid_row) {
    let userid = userid_row.userid;
    let user = yield get_user_by_hid(userid);

    let rows = yield conn.query(`
      SELECT userid,threadid,emailupdate
      FROM subscribethread
      WHERE userid = ?
    `, [ userid ]);

    let bulk = N.models.users.Subscription.collection.initializeUnorderedBulkOp();
    let count = 0;

    for (let i = 0; i < rows.length; i++) {
      let row = rows[i];

      bar.tick();

      if (!user) continue;

      let topic = yield N.models.forum.Topic.findOne()
                                            .where('hid', row.threadid)
                                            .select('_id')
                                            .lean(true);

      if (!topic) continue;

      // in the old forum, 0 means no emails are sent, 1 means emails are sent
      // for every message, 2 and 3 are daily/weekly digests
      let type = row.emailupdate === 1 ? 'WATCHING' : 'TRACKING';

      count++;
      bulk.find({
        user:  user._id,
        to:    topic._id
      }).upsert().update({
        $setOnInsert: {
          user:    user._id,
          to:      topic._id,
          to_type: N.models.users.Subscription.to_types.FORUM_TOPIC,
          type:    N.models.users.Subscription.types[type]
        }
      });
    }

    if (count) yield bulk.execute();
  }), { concurrency: 100 });

  bar.terminate();

  get_user_by_hid.clear();
  conn.release();
  N.logger.info('Subscription import finished');
});
