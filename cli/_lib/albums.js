// Convert albums
//

'use strict';

const Promise   = require('bluebird');
const co        = require('co');
const mongoose  = require('mongoose');
const progress  = require('./utils').progress;
const ALBUM     = 8; // content type for albums


module.exports = co.wrap(function* (N) {
  let conn = yield N.vbconvert.getConnection();

  let rows = yield conn.query('SELECT count(*) AS count FROM album');

  let bar = progress(' albums :current/:total [:bar] :percent', rows[0].count);

  let userids = yield conn.query('SELECT userid FROM album GROUP BY userid ORDER BY userid ASC');

  yield Promise.map(userids, co.wrap(function* (row) {
    let userid = row.userid;
    let user = yield N.models.users.User.findOne({ hid: userid }).lean(true);

    // ignore albums belonging to deleted users
    if (!user) return;

    let rows = yield conn.query(`
      SELECT albumid,title,description,createdate,lastpicturedate
      FROM album
      WHERE userid = ?
      ORDER BY albumid ASC
    `, [ userid ]);

    for (let i = 0; i < rows.length; i++) {
      bar.tick();

      let row = rows[i];
      let album_mapping = yield N.models.vbconvert.AlbumMapping.findOne(
                            { mysql: row.albumid }
                          );

      // already imported
      if (album_mapping) continue;

      let datelines = yield conn.query(`
        SELECT dateline
        FROM attachment
        WHERE contenttypeid = ? AND contentid = ?
        ORDER BY dateline ASC
      `, [ ALBUM, row.albumid ]);

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

      yield new N.models.vbconvert.AlbumMapping({
        mysql: row.albumid,
        mongo: album._id
      }).save();

      yield album.save();
    }
  }), { concurrency: 100 });

  bar.terminate();
  conn.release();
  N.logger.info('Album import finished');
});
