// Import forum votes
//

'use strict';

const _        = require('lodash');
const mongoose = require('mongoose');
const progress = require('./utils').progress;

const BULK_SIZE = 10000;
const POST      = 1; // content type for posts


module.exports = async function (N) {
  const conn = await N.vbconvert.getConnection();

  let count = (await conn.query(`
    SELECT count(*) AS total
    FROM votes
    WHERE contenttypeid = ?
  `, [ POST ]))[0][0].total;

  let bar = progress(' votes :current/:total :percent', count);

  // date is not unique, so we iterate with >= condition,
  // re-importing last vote in last chunk as first vote in next one
  let last_date = -1;

  for (;;) {
    let rows = (await conn.query(`
      SELECT targetid,vote,fromuserid,touserid,date
      FROM votes
      WHERE date >= ? AND contenttypeid = ?
      ORDER BY date ASC
      LIMIT ?
    `, [ last_date, POST, BULK_SIZE ]))[0];

    if (rows.length === 0) break;

    let bulk = N.models.users.Vote.collection.initializeUnorderedBulkOp();

    let users = await N.models.users.User.find()
                          .where('hid').in(_.uniq(
                            _.map(rows, 'fromuserid').concat(_.map(rows, 'touserid'))
                          ))
                          .select('hid hb _id')
                          .lean(true);

    let users_by_hid = _.keyBy(users, 'hid');

    let pmap = await N.models.vbconvert.PostMapping.find()
                          .where('mysql').in(_.uniq(_.map(rows, 'targetid')))
                          .select('post_id mysql')
                          .lean(true);

    let pmap_by_mysql_id = _.keyBy(pmap, 'mysql');

    for (let row of rows) {
      let from_user = users_by_hid[row.fromuserid];
      if (!from_user) continue;

      let to_user = users_by_hid[row.touserid];
      if (!to_user) continue;

      let post_mapping = pmap_by_mysql_id[row.targetid];
      if (!post_mapping) continue;

      bulk.find({
        from:  from_user._id,
        to:    to_user._id,
        'for': post_mapping.post_id,
        type:  N.shared.content_type.FORUM_POST
      }).upsert().update({
        $setOnInsert: {
          _id:   new mongoose.Types.ObjectId(row.date),
          from:  from_user._id,
          to:    to_user._id,
          'for': post_mapping.post_id,
          type:  N.shared.content_type.FORUM_POST,
          hb:    from_user.hb,
          value: Number(row.vote)
        }
      });
    }

    if (bulk.length > 0) await bulk.execute();

    if (last_date === rows[rows.length - 1].date) break;

    last_date = rows[rows.length - 1].date;
    bar.tick(rows.length);
  }

  bar.terminate();
  conn.release();
  N.logger.info('Vote import finished');
};
