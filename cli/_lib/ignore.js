// Import ignore list
//

'use strict';

const Promise   = require('bluebird');
const mongoose  = require('mongoose');
const memoize   = require('promise-memoize');
const progress  = require('./utils').progress;


module.exports = Promise.coroutine(function* (N) {
  let conn = yield N.vbconvert.getConnection();

  const get_user_by_hid = memoize(function (hid) {
    return N.models.users.User.findOne({ hid }).lean(true);
  });


  let rows = (yield conn.query('SELECT * FROM userlist WHERE type="ignore"'))[0];

  let bar = progress(' ignores :current/:total :percent', rows.length);

  let bulk = N.models.users.Ignore.collection.initializeUnorderedBulkOp();
  let count = 0;

  yield Promise.map(rows, Promise.coroutine(function* (row) {
    bar.tick();

    let fromuser = yield get_user_by_hid(row.userid);
    let touser   = yield get_user_by_hid(row.relationid);

    if (!fromuser || !touser) return;

    // earliest valid date is Apr 2011, so use 2010 as a default value
    let ignorestart = row.ignorestart || new Date('2010-01-01').valueOf() / 1000;

    let ignore = {
      _id:    new mongoose.Types.ObjectId(ignorestart),
      from:   fromuser._id,
      to:     touser._id,
      ts:     new Date(ignorestart * 1000)
    };

    if (row.ignorereason) ignore.reason = row.ignorereason;
    if (row.ignoreend)    ignore.expire = new Date(row.ignoreend * 1000);

    count++;
    bulk.find({
      from: ignore.from,
      to:   ignore.to
    }).upsert().update({
      $setOnInsert: ignore
    });
  }), { concurrency: 100 });

  if (count) yield bulk.execute();

  bar.terminate();

  get_user_by_hid.clear();
  conn.release();
  N.logger.info('Ignore list import finished');
});
