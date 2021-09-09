// Import pm log
//

'use strict';

const mongoose = require('mongoose');


module.exports = async function (N) {
  let conn = await N.vbconvert.getConnection();

  let rows = (await conn.query('SELECT * FROM rcd_log_pm'))[0];

  // re-import all logs from scratch every time
  await N.models.vbconvert.OldRcdPmLog.deleteMany({});

  // insert all in one bulk query because there's only ~65k entries
  let bulk = N.models.vbconvert.OldRcdPmLog.collection.initializeOrderedBulkOp();

  for (let row of rows) {
    bulk.insert({
      _id: new mongoose.Types.ObjectId(row.dateline),
      ...row
    });
  }

  if (bulk.length) await bulk.execute();

  conn.release();
  N.logger.info('Old PM log import finished');
};
