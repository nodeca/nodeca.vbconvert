// Convert albums
//

'use strict';

const Promise   = require('bluebird');
const mongoose  = require('mongoose');
const progress  = require('./utils').progress;
const ALBUM     = 8; // content type for albums


module.exports = async function (N) {
  let conn = await N.vbconvert.getConnection();

  let rows = (await conn.query('SELECT count(*) AS count FROM album'))[0];

  let bar = progress(' albums :current/:total :percent', rows[0].count);

  let userids = (await conn.query('SELECT userid FROM album GROUP BY userid ORDER BY userid ASC'))[0];

  await Promise.map(userids, async row => {
    let userid = row.userid;
    let user = await N.models.users.User.findOne({ hid: userid }).lean(true);

    // ignore albums belonging to deleted users
    if (!user) return;

    // mark user as active
    if (!user.active) {
      await N.models.users.User.updateOne({ _id: user._id }, { $set: { active: true } });
    }

    let rows = (await conn.query(`
      SELECT albumid,title,description,createdate,lastpicturedate
      FROM album
      WHERE userid = ?
      ORDER BY albumid ASC
    `, [ userid ]))[0];

    for (let row of rows) {
      bar.tick();

      let album_mapping = await N.models.vbconvert.AlbumMapping.findOne()
                                    .where('mysql', row.albumid)
                                    .lean(true);

      // already imported
      if (album_mapping) continue;

      let datelines = (await conn.query(`
        SELECT dateline
        FROM attachment
        WHERE contenttypeid = ? AND contentid = ?
        ORDER BY dateline ASC
      `, [ ALBUM, row.albumid ]))[0];

      datelines = datelines || [];

      let album = new N.models.users.Album();

      album.title       = row.title;
      album.description = row.description;
      album.user        = user._id;

      if (row.createdate) {
        album._id = new mongoose.Types.ObjectId(row.createdate);
      } else if (datelines.length) {
        album._id = new mongoose.Types.ObjectId(datelines[0].dateline);
      }

      if (datelines.length) {
        album.last_ts = new Date(datelines[datelines.length - 1].dateline * 1000);
      } else if (row.lastpicturedate) {
        album.last_ts = new Date(row.lastpicturedate * 1000);
      }

      await new N.models.vbconvert.AlbumMapping({
        mysql: row.albumid,
        mongo: album._id
      }).save();

      await album.save();
    }
  }, { concurrency: 100 });

  bar.terminate();
  conn.release();
  N.logger.info('Album import finished');
};
