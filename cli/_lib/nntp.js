// Import NNTP groups
//

'use strict';

const mongoose = require('mongoose');


module.exports = async function (N) {
  let conn = await N.vbconvert.getConnection();

  let rows = (await conn.query(`
    SELECT group_name,map_id,date_create
    FROM nntp_groups
    WHERE plugin_id = 'forum'
      AND is_active = 'yes'
    ORDER BY id ASC
  `))[0];

  await Promise.all(rows.map(async function (row) {
    let section = await N.models.forum.Section.findOne()
                            .where('hid', row.map_id)
                            .lean(true);

    if (!section) return;

    let existing_group = await N.models.nntp.Group.findOne()
                                   .where('source', section._id)
                                   .lean(true);

    // nntp group is already imported
    if (existing_group) return;

    await new N.models.nntp.Group({
      _id:    new mongoose.Types.ObjectId(row.date_create.valueOf() / 1000),
      name:   row.group_name,
      source: section._id,
      type:   'forum'
    }).save();
  }));

  conn.release();
  N.logger.info('NNTP import finished');
};
