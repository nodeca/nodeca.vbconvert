// Import clubs (social groups)
//

'use strict';

const mongoose = require('mongoose');


module.exports = async function (N) {
  let conn = await N.vbconvert.getConnection();

  // select all sections except link-only
  let rows = (await conn.query(`
    SELECT groupid,name,description,creatoruserid,dateline,members
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
    club.hid         = row.groupid;
    club.title       = row.name;
    club.description = row.description;
    club.members     = row.members;
    club.members_hb  = row.members;
    club.admin_ids   = [];

    let creator = await N.models.users.User.findOne()
                            .where('hid', row.creatoruserid)
                            .select('_id')
                            .lean(true);

    if (creator) club.admin_ids.push(creator._id);

    await club.save();
  }));

  await N.models.core.Increment.update(
    { key: 'clubs_sole' },
    { $set: { value: rows[rows.length - 1].groupid } },
    { upsert: true }
  );

  conn.release();
  N.logger.info('Club import finished');
};
