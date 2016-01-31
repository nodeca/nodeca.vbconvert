// Convert files
//

'use strict';

const _           = require('lodash');
const Promise     = require('bluebird');
const co          = require('co');
const fs          = require('mz/fs');
const sharp       = require('sharp');
const path        = require('path');
const progress    = require('./utils').progress;
const resizeParse = require('nodeca.users/server/_lib/resize_parse');
const resize      = require('nodeca.users/models/users/_lib/resize');


module.exports = co.wrap(function* (N) {
  let config     = resizeParse(N.config.users.avatars);
  let min_width  = _.reduce(config.resize, function (acc, obj) {
    return Math.max(acc, obj.width);
  }, 0);
  let min_height = _.reduce(config.resize, function (acc, obj) {
    return Math.max(acc, obj.height);
  }, 0);

  let conn = yield N.vbconvert.getConnection();

  let rows = yield conn.query(`
    SELECT userid,width,height,bigpicrevision,dateline,
           sel_top,sel_left,sel_width,sel_height
    FROM custombigpic JOIN user USING(userid)
    WHERE bigpicsaved = 1
    ORDER BY userid ASC
  `);

  let bar = progress(' avatars :current/:total [:bar] :percent', rows.length);
  let counter = 0;

  yield Promise.map(rows, co.wrap(function* (row) {
    bar.tick();

    let tmpfile = '/tmp/vbconvert-' + (++counter) + '.jpg';

    let user = yield N.models.users.User.findOne({ hid: row.userid }).lean(true);

    // already imported
    if (user.avatar_id) return;

    // 1. avatar removed (both sel_width and sel_height are zero)
    // 2. avatar is too small and we can't scale it up while preserving aspect ratio
    if (row.sel_width < min_width || row.sel_height < min_height) return;

    let sharpInstance = sharp(path.join(
      N.config.vbconvert.avatars,
      String(row.userid) + '_' + row.bigpicrevision + '.jpg')
    );

    sharpInstance.rotate().extract({
      width:  row.sel_width,
      height: row.sel_height,
      left:   row.sel_left,
      top:    row.sel_top
    });

    yield sharpInstance.toFile(tmpfile);

    try {
      let data = yield resize(tmpfile, {
        store:   N.models.core.File,
        ext:     'jpeg',

        // old files don't have timestamp,
        // so use 01 Jan 2011 for those
        date:    Math.max(row.dateline, 1293840000),

        resize:  config.types.jpg.resize
      });

      yield N.models.users.User.update(
              { hid: row.userid },
              { avatar_id: data.id }
            );
    } finally {
      yield fs.unlink(tmpfile);
    }
  }), { concurrency: 100 });

  bar.terminate();
  conn.release();
  N.logger.info('Avatar import finished');
});
