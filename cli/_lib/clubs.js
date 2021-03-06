// Import clubs (social groups)
//

'use strict';


const _             = require('lodash');
const mongoose      = require('mongoose');
const html_unescape = require('nodeca.vbconvert/lib/html_unescape_entities');


module.exports = async function (N) {
  let conn = await N.vbconvert.getConnection();
  let rows;

  // select all sections except link-only
  rows = (await conn.query(`
    SELECT groupid,name,description,type,creatoruserid,dateline,members,lastpost
    FROM socialgroup
    ORDER BY groupid ASC
  `))[0];

  //
  // Create clubs
  //
  await Promise.all(rows.map(async row => {
    let message_count = (await conn.query(`
      SELECT sum(visible) + sum(deleted) AS sum
      FROM discussion
      WHERE groupid = ?
    `, [ row.groupid ]))[0][0].sum;

    // ignore clubs with 2 or less messages
    if (message_count <= 2) return;

    let existing_club = await N.models.clubs.Club.findOne()
                                  .where('hid', row.groupid)
                                  .lean(true);

    // section with this id is already imported
    if (existing_club) return;

    let club = new N.models.clubs.Club();

    club._id         = new mongoose.Types.ObjectId(row.dateline);
    club.created_ts  = new Date(row.dateline * 1000);
    club.hid         = row.groupid;
    club.title       = html_unescape(row.name);
    club.description = html_unescape(row.description);
    club.members     = row.members;
    club.is_closed   = row.type !== 'public';
    club.cache       = { last_ts: new Date(row.lastpost * 1000) };
    club.cache_hb    = { last_ts: new Date(row.lastpost * 1000) };

    await club.save();

    await new N.models.vbconvert.ClubTitle({
      mysql:       row.groupid,
      title:       row.name,
      description: row.description
    }).save();
  }));

  await N.models.core.Increment.updateOne(
    { key: 'clubs_sole' },
    { $set: { value: rows[rows.length - 1].groupid } },
    { upsert: true }
  );

  //
  // Import club members
  //
  rows = (await conn.query(`
    SELECT socialgroupmember.userid,socialgroup.creatoruserid,socialgroupmember.dateline,groupid
    FROM socialgroupmember JOIN socialgroup USING(groupid)
  `))[0];

  let bulk = N.models.clubs.Membership.collection.initializeUnorderedBulkOp();

  let users = await N.models.users.User.find()
                        .where('hid').in(_.uniq(_.map(rows, 'userid')))
                        .select('hid _id')
                        .lean(true);

  let users_by_hid = _.keyBy(users, 'hid');

  let clubs = await N.models.clubs.Club.find()
                        .where('hid').in(_.uniq(_.map(rows, 'groupid')))
                        .select('hid _id')
                        .lean(true);

  let clubs_by_hid = _.keyBy(clubs, 'hid');

  for (let row of rows) {
    let user = users_by_hid[row.userid];
    if (!user) continue;

    let club = clubs_by_hid[row.groupid];
    if (!club) continue;

    bulk.find({
      user: user._id,
      club: club._id
    }).upsert().update({
      $setOnInsert: {
        _id:       new mongoose.Types.ObjectId(row.dateline),
        user:      user._id,
        club:      club._id,
        is_owner:  row.userid === row.creatoruserid,
        joined_ts: new Date(row.dateline * 1000)
      }
    });
  }

  if (bulk.length > 0) await bulk.execute();

  conn.release();
  N.logger.info('Club import finished');
};
