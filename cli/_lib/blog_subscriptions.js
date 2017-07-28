// Import subscriptions to blog users and entries
//

'use strict';

const Promise  = require('bluebird');
const mongoose = require('mongoose');
const memoize  = require('promise-memoize');
const progress = require('./utils').progress;


module.exports = async function (N) {
  let conn = await N.vbconvert.getConnection();
  let rows, bar, userids;

  const get_user_by_hid = memoize(function (hid) {
    return N.models.users.User.findOne({ hid }).lean(true);
  });

  //
  // Blog user subscriptions
  //

  rows = (await conn.query('SELECT count(*) AS count FROM blog_subscribeuser'))[0];

  bar = progress(' blog user subscriptions :current/:total :percent', rows[0].count);

  userids = (await conn.query(`
    SELECT userid FROM blog_subscribeuser
    GROUP BY userid
    ORDER BY userid ASC
  `))[0];

  await Promise.map(userids, async function (userid_row) {
    let userid = userid_row.userid;
    let user = await get_user_by_hid(userid);

    let rows = (await conn.query(`
      SELECT userid,bloguserid,dateline,type
      FROM blog_subscribeuser
      WHERE userid = ?
    `, [ userid ]))[0];

    let bulk = N.models.users.Subscription.collection.initializeUnorderedBulkOp();
    let count = 0;

    for (let row of rows) {
      bar.tick();

      if (!user) continue;

      let to_user = await get_user_by_hid(row.bloguserid);

      if (!to_user) continue;

      let type = row.type === 'email' ? 'WATCHING' : 'TRACKING';

      count++;
      bulk.find({
        user:  user._id,
        to:    to_user._id
      }).upsert().update({
        $setOnInsert: {
          _id:     new mongoose.Types.ObjectId(row.dateline),
          user:    user._id,
          to:      to_user._id,
          to_type: N.shared.content_type.BLOG_SOLE,
          type:    N.models.users.Subscription.types[type]
        }
      });
    }

    if (count) await bulk.execute();
  }, { concurrency: 100 });

  //
  // Blog entry subscriptions
  //

  rows = (await conn.query('SELECT count(*) AS count FROM blog_subscribeentry'))[0];

  bar = progress(' blog entry subscriptions :current/:total :percent', rows[0].count);

  userids = (await conn.query(`
    SELECT userid FROM blog_subscribeentry
    GROUP BY userid
    ORDER BY userid ASC
  `))[0];

  await Promise.map(userids, async function (userid_row) {
    let userid = userid_row.userid;
    let user = await get_user_by_hid(userid);

    let rows = (await conn.query(`
      SELECT userid,blogid,dateline,type
      FROM blog_subscribeentry
      WHERE userid = ?
    `, [ userid ]))[0];

    let bulk = N.models.users.Subscription.collection.initializeUnorderedBulkOp();
    let count = 0;

    for (let row of rows) {
      bar.tick();

      if (!user) continue;

      let blog = await N.models.blogs.BlogEntry.findOne()
                           .where('hid', row.blogid)
                           .select('_id')
                           .lean(true);

      if (!blog) continue;

      let type = row.type === 'email' ? 'WATCHING' : 'TRACKING';

      count++;
      bulk.find({
        user:  user._id,
        to:    blog._id
      }).upsert().update({
        $setOnInsert: {
          _id:     new mongoose.Types.ObjectId(row.dateline),
          user:    user._id,
          to:      blog._id,
          to_type: N.shared.content_type.BLOG_ENTRY,
          type:    N.models.users.Subscription.types[type]
        }
      });
    }

    if (count) await bulk.execute();
  }, { concurrency: 100 });

  get_user_by_hid.clear();
  conn.release();
  N.logger.info('Blog subscription import finished');
};
