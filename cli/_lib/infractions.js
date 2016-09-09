// Import infractions
//

'use strict';

const Promise       = require('bluebird');
const co            = require('bluebird-co').co;
const mongoose      = require('mongoose');
const memoize       = require('promise-memoize');
const html_unescape = require('./utils').html_unescape;
const progress      = require('./utils').progress;


module.exports = co.wrap(function* (N) {
  let conn = yield N.vbconvert.getConnection();
  let rows, bar;

  const get_user_by_hid = memoize(function (hid) {
    return N.models.users.User.findOne({ hid }).lean(true);
  });

  // remove old infractions in case import is restarted
  yield N.models.users.Infraction.remove({});
  yield N.models.users.UserPenalty.remove({});

  //
  // Import infractions
  //
  rows = (yield conn.query(`
    SELECT postid,userid,infractionlevelid,whoadded,points,dateline,customreason,expires
    FROM infraction
    ORDER BY infractionid ASC
  `))[0];

  bar = progress(' infractions :current/:total [:bar] :percent', rows.length);

  yield Promise.map(rows, co.wrap(function* (row) {
    bar.tick();

    let user = yield get_user_by_hid(row.userid);

    if (!user) return;

    let infraction = {
      _id:    new mongoose.Types.ObjectId(row.dateline),
      from:   (yield get_user_by_hid(row.whoadded))._id,
      'for':  user._id,
      type:   'custom',
      points: row.points,
      ts:     new Date(row.dateline * 1000),
      exists: true
    };

    if (row.expires) {
      infraction.expire = new Date(row.expires * 1000);
    }

    if (row.infractionlevelid) {
      infraction.type = N.config.vbconvert.infraction_types[row.infractionlevelid];
    }

    if (row.customreason) {
      infraction.reason = html_unescape(row.customreason);
    }

    if (infraction.type !== 'custom') {
      infraction.reason = N.i18n.t(N.config.locales[0], 'users.infractions.types.' + infraction.type);
    }

    if (row.postid) {
      let post = yield N.models.vbconvert.PostMapping.findOne({ mysql: row.postid });

      if (post) {
        infraction.src = post.post_id;
        infraction.src_type = 'FORUM_POST';
      }
    }

    yield N.models.users.Infraction.collection.insert(infraction);
  }), { concurrency: 100 });

  bar.terminate();

  //
  // Import consequences for infractions
  //
  rows = (yield conn.query(`
    SELECT userid,bandate,liftdate
    FROM userban
    ORDER BY bandate ASC
  `))[0];

  let bulk = N.models.users.UserPenalty.collection.initializeOrderedBulkOp();
  let count = 0;

  rows = rows.filter(row => !!row.liftdate);

  bar = progress(' infractions (bans) :current/:total [:bar] :percent', rows.length);

  yield Promise.map(rows, co.wrap(function* (row) {
    bar.tick();

    let user = yield get_user_by_hid(row.userid);

    if (!user) return;

    let entry = {
      _id:    new mongoose.Types.ObjectId(row.bandate),
      user:   user._id,
      type:   'to_violators',
      expire: new Date(row.liftdate * 1000)
    };

    count++;
    bulk.insert(entry);
  }), { concurrency: 100 });

  if (count) yield bulk.execute();

  bar.terminate();

  get_user_by_hid.clear();
  conn.release();
  N.logger.info('Infraction import finished');
});
