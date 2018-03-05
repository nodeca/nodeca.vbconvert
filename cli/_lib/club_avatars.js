// Convert club icons
//

'use strict';

const _           = require('lodash');
const Promise     = require('bluebird');
const path        = require('path');
const resizeParse = require('nodeca.users/server/_lib/resize_parse');
const resize      = require('nodeca.users/models/users/_lib/resize');


module.exports = async function (N) {
  let config     = resizeParse(N.config.users.avatars);
  let min_width  = _.reduce(config.resize, function (acc, obj) {
    return Math.max(acc, obj.width);
  }, 0);
  let min_height = _.reduce(config.resize, function (acc, obj) {
    return Math.max(acc, obj.height);
  }, 0);

  let conn = await N.vbconvert.getConnection();

  let rows = (await conn.query(`
    SELECT groupid,width,height,dateline
    FROM socialgroupicon
    ORDER BY groupid ASC
  `))[0];

  await Promise.all(rows.map(async row => {
    let club = await N.models.clubs.Club.findOne()
                         .where('hid', row.groupid)
                         .lean(true);

    if (!club) return;

    // already imported
    if (club.avatar_id) return;

    // avatar is too small and we can't scale it up while preserving aspect ratio
    if (row.width < min_width || row.height < min_height) return;

    let file = path.join(
      N.config.vbconvert.club_avatars,
      'socialgroupicon_' + String(row.groupid) + '_' + row.dateline + '.gif'
    );

    let data = await resize(file, {
      store:   N.models.core.File,
      ext:     'jpeg',
      date:    row.dateline,
      resize:  config.types.jpg.resize
    });

    await N.models.clubs.Club.update(
            { hid: row.groupid },
            { avatar_id: data.id }
          );
  }));

  conn.release();
  N.logger.info('Club avatar import finished');
};
