// Import infractions
//

'use strict';

const Promise       = require('bluebird');
const mongoose      = require('mongoose');
const memoize       = require('promise-memoize');
const html_unescape = require('nodeca.vbconvert/lib/html_unescape_entities');
const progress      = require('./utils').progress;


module.exports = async function (N) {
  let conn = await N.vbconvert.getConnection();
  let rows, bar;

  const get_user_by_hid = memoize(function (hid) {
    return N.models.users.User.findOne({ hid }).lean(true);
  });

  // remove old infractions in case import is restarted
  await N.models.users.Infraction.remove({});
  await N.models.users.UserPenalty.remove({});

  //
  // Import infractions
  //
  rows = (await conn.query(`
    SELECT postid,userid,infractionlevelid,whoadded,points,dateline,customreason,expires
    FROM infraction
    ORDER BY infractionid ASC
  `))[0];

  bar = progress(' infractions :current/:total :percent', rows.length);

  await Promise.map(rows, async row => {
    bar.tick();

    let user = await get_user_by_hid(row.userid);

    if (!user) return;

    let infraction = {
      _id:    new mongoose.Types.ObjectId(row.dateline),
      from:   (await get_user_by_hid(row.whoadded))._id,
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
      let post = await N.models.vbconvert.PostMapping.findOne({ mysql: row.postid });

      if (post) {
        infraction.src = post.post_id;
        infraction.src_type = N.shared.content_type.FORUM_POST;
      }
    }

    await N.models.users.Infraction.collection.insert(infraction);
  }, { concurrency: 100 });

  bar.terminate();

  //
  // Import consequences for infractions
  //
  rows = (await conn.query(`
    SELECT userid,bandate,liftdate
    FROM userban
    ORDER BY bandate ASC
  `))[0];

  let bulk = N.models.users.UserPenalty.collection.initializeOrderedBulkOp();
  let count = 0;

  rows = rows.filter(row => !!row.liftdate);

  bar = progress(' infractions (bans) :current/:total :percent', rows.length);

  await Promise.map(rows, async row => {
    bar.tick();

    let user = await get_user_by_hid(row.userid);

    if (!user) return;

    let entry = {
      _id:    new mongoose.Types.ObjectId(row.bandate),
      user:   user._id,
      type:   'to_violators',
      expire: new Date(row.liftdate * 1000)
    };

    count++;
    bulk.insert(entry);
  }, { concurrency: 100 });

  if (count) await bulk.execute();

  bar.terminate();

  get_user_by_hid.clear();
  conn.release();
  N.logger.info('Infraction import finished');
};
