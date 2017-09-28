// Import subscriptions to topics and sections
//

'use strict';

const _        = require('lodash');
const progress = require('./utils').progress;

const BULK_SIZE = 10000;


module.exports = async function (N) {
  const conn = await N.vbconvert.getConnection();


  async function import_section_subscriptions() {
    let count = (await conn.query('SELECT count(*) AS total FROM subscribeforum'))[0][0].total;
    let bar = progress(' section subscriptions :current/:total :percent', count);
    let last_id = -1;

    for (;;) {
      let rows = (await conn.query(`
        SELECT *
        FROM subscribeforum
        WHERE subscribeforumid > ?
        ORDER BY subscribeforumid ASC
        LIMIT ?
      `, [ last_id, BULK_SIZE ]))[0];

      if (rows.length === 0) break;

      let bulk = N.models.users.Subscription.collection.initializeUnorderedBulkOp();

      let users = await N.models.users.User.find()
                            .where('hid').in(_.uniq(_.map(rows, 'userid')))
                            .select('hid _id')
                            .lean(true);

      let users_by_hid = _.keyBy(users, 'hid');

      let sections = await N.models.forum.Section.find()
                             .where('hid').in(_.uniq(_.map(rows, 'forumid')))
                             .select('hid _id')
                             .lean(true);

      let sections_by_hid = _.keyBy(sections, 'hid');

      for (let row of rows) {
        let user = users_by_hid[row.userid];
        if (!user) continue;

        let section = sections_by_hid[row.forumid];
        if (!section) continue;

        // in the old forum, 0 means no emails are sent, 1 means emails are sent
        // for every message, 2 and 3 are daily/weekly digests
        let type = row.emailupdate === 1 ? 'WATCHING' : 'TRACKING';

        bulk.find({
          user:  user._id,
          to:    section._id
        }).upsert().update({
          $setOnInsert: {
            user:    user._id,
            to:      section._id,
            to_type: N.shared.content_type.FORUM_SECTION,
            type:    N.models.users.Subscription.types[type]
          }
        });
      }

      if (bulk.length > 0) await bulk.execute();

      last_id = rows[rows.length - 1].subscribeforumid;
      bar.tick(rows.length);
    }

    bar.terminate();
  }


  async function import_topic_subscriptions() {
    let count = (await conn.query('SELECT count(*) AS total FROM subscribethread'))[0][0].total;
    let bar = progress(' topic subscriptions :current/:total :percent', count);
    let last_id = -1;

    for (;;) {
      let rows = (await conn.query(`
        SELECT *
        FROM subscribethread
        WHERE subscribethreadid > ?
        ORDER BY subscribethreadid ASC
        LIMIT ?
      `, [ last_id, BULK_SIZE ]))[0];

      if (rows.length === 0) break;

      let bulk = N.models.users.Subscription.collection.initializeUnorderedBulkOp();

      let users = await N.models.users.User.find()
                            .where('hid').in(_.uniq(_.map(rows, 'userid')))
                            .select('hid _id')
                            .lean(true);

      let users_by_hid = _.keyBy(users, 'hid');

      let topics = await N.models.forum.Topic.find()
                             .where('hid').in(_.uniq(_.map(rows, 'threadid')))
                             .select('hid _id')
                             .lean(true);

      let topics_by_hid = _.keyBy(topics, 'hid');

      for (let row of rows) {
        let user = users_by_hid[row.userid];
        if (!user) continue;

        let topic = topics_by_hid[row.threadid];
        if (!topic) continue;

        // in the old forum, 0 means no emails are sent, 1 means emails are sent
        // for every message, 2 and 3 are daily/weekly digests
        let type = row.emailupdate === 1 ? 'WATCHING' : 'TRACKING';

        bulk.find({
          user:  user._id,
          to:    topic._id
        }).upsert().update({
          $setOnInsert: {
            user:    user._id,
            to:      topic._id,
            to_type: N.shared.content_type.FORUM_TOPIC,
            type:    N.models.users.Subscription.types[type]
          }
        });
      }

      if (bulk.length > 0) await bulk.execute();

      last_id = rows[rows.length - 1].subscribethreadid;
      bar.tick(rows.length);
    }

    bar.terminate();
  }

  await import_section_subscriptions();
  await import_topic_subscriptions();

  conn.release();
  N.logger.info('Subscription import finished');
};
