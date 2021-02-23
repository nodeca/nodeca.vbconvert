// Convert files
//

'use strict';

const _           = require('lodash');
const Promise     = require('bluebird');
const stat        = require('util').promisify(require('fs').stat);
const mime        = require('mime-types').lookup;
const mongoose    = require('mongoose');
const path        = require('path');
const progress    = require('./utils').progress;
const resize      = require('nodeca.users/models/users/_lib/resize');
const resizeParse = require('nodeca.users/server/_lib/resize_parse');

// content types are from `contenttype` table in mysql
const POST       = 1;
//const GROUP    = 7;
const ALBUM      = 8;
const BLOG_ENTRY = 15;


module.exports = async function (N) {
  let mediaConfig = resizeParse(N.config.users.uploads);

  // Chopped-down version of N.models.users.MediaInfo.createFile
  //
  async function create_file(filedata, filepath, user, album_id) {
    let media = new N.models.users.MediaInfo();

    media._id         = new mongoose.Types.ObjectId(filedata.dateline);
    media.user        = user._id;
    media.album       = album_id;
    media.ts          = new Date(filedata.dateline * 1000);
    media.file_name   = filedata.filename;
    media.description = filedata.caption;

    let supportedImageFormats = [ 'bmp', 'gif', 'jpg', 'jpeg', 'png' ];

    // Just save if file is not an image
    if (supportedImageFormats.indexOf(filedata.extension) === -1) {
      let stats = await stat(filepath);

      let storeOptions = {
        _id: new mongoose.Types.ObjectId(filedata.dateline),
        contentType: mime(filedata.extension),
        metadata: {
          origName: filedata.filename
        }
      };

      let id = await N.models.core.File.put(filepath, storeOptions);

      media.type      = N.models.users.MediaInfo.types.BINARY;
      media.media_id  = id;
      media.file_size = stats.size;
    } else {
      let resizeConfig = _.cloneDeep(mediaConfig.types[filedata.extension].resize);

      resizeConfig.orig.skip_size = Infinity;

      let data = await resize(
        filepath,
        {
          store:   N.models.core.File,
          ext:     filedata.extension,
          date:    filedata.dateline,
          resize:  resizeConfig
        }
      );

      media.type        = N.models.users.MediaInfo.types.IMAGE;
      media.image_sizes = data.images;
      media.media_id    = data.id;
      media.file_size   = data.size;
    }

    await media.save();
    return media;
  }


  // Create file, add it to album and add it to post if necessary
  //
  async function add_file(row, user, album_ids) {
    let albumid = album_ids[row.contenttypeid === ALBUM ? row.contentid : 0].id;
    let filepath = path.join(N.config.vbconvert.files,
          String(row.filedataowner).split('').join('/'),
          row.filedataid + '.attach');

    let media;

    try {
      media = await create_file(row, filepath, user, albumid);
    } catch (err) {
      // some files are considered corrupted by gm, we should log those
      N.logger.warn('File import: ' + err.message + ' (processing ' + filepath + ')');
      return null;
    }

    await N.models.users.UserExtra.updateOne(
      { user: media.user },
      { $inc: { media_size: media.file_size } }
    );

    let album = album_ids[row.contenttypeid === ALBUM ? row.contentid : 0];

    let updateData = { $inc: { count: 1 } };

    // only set cover if:
    //  1. cover info doesn't exist in mysql (last image will be the cover)
    //  2. cover exist and is equal to current row
    if (!album.cover || album.cover === row.attachmentid) {
      updateData.$set = { cover_id: media.media_id };
    }

    await N.models.users.Album.updateOne({ _id: album.id }, updateData);

    if (row.contenttypeid === POST) {
      await N.models.vbconvert.PostMapping.updateOne(
              { mysql: row.contentid },
              { $push: { attach: row.attachmentid } }
            );
    } else if (row.contenttypeid === BLOG_ENTRY) {
      await N.models.vbconvert.BlogTextMapping.updateOne(
              { mysql: row.contentid, is_comment: false },
              { $push: { attach: row.attachmentid } }
            );
    }

    return media;
  }


  const conn = await N.vbconvert.getConnection();

  let rows = (await conn.query('SELECT count(*) AS count FROM attachment'))[0];

  let bar = progress(' files :current/:total :percent', rows[0].count);

  let userids = (await conn.query('SELECT userid FROM attachment GROUP BY userid ORDER BY userid ASC'))[0];

  await Promise.map(userids, async row => {
    let rows;
    let userid = row.userid;

    let already_imported = await N.redis.zscore('vbconvert:files', userid);

    // if all files for this user were already imported,
    // amount of those files is stored in redis, so we can skip faster
    if (already_imported !== null) {
      bar.tick(Number(already_imported));
      return;
    }

    let user = await N.models.users.User.findOne({ hid: userid }).lean(true);

    // ignore content owned by deleted users
    if (!user) return;

    // mark user as active
    if (!user.active) {
      await N.models.users.User.updateOne({ _id: user._id }, { $set: { active: true } });
    }

    rows = (await conn.query(`
      SELECT albumid,coverattachmentid
      FROM album WHERE userid = ? ORDER BY albumid ASC
    `, [ userid ]))[0];

    let album_ids = {};

    for (let row of rows) {
      let album_mapping = await N.models.vbconvert.AlbumMapping.findOne()
                                    .where('mysql', row.albumid)
                                    .lean(true);

      album_ids[album_mapping.mysql] = {
        id: album_mapping.mongo,
        cover: row.coverattachmentid
      };
    }

    let def_album = await N.models.users.Album.findOne()
                              .where('user', user._id)
                              .where('default', true)
                              .lean(true);

    album_ids[0] = { id: def_album._id };

    rows = (await conn.query(`
      SELECT filedata.userid AS filedataowner,
             filedataid,attachment.attachmentid,extension,filename,
             caption,contentid,contenttypeid,attachment.dateline,
             blog_attachmentlegacy.oldattachmentid AS blogaid_legacy,
             picturelegacy.pictureid AS pictureaid_legacy
      FROM filedata
      JOIN attachment USING(filedataid)
      LEFT JOIN blog_attachmentlegacy
             ON blog_attachmentlegacy.newattachmentid = attachment.attachmentid
      LEFT JOIN picturelegacy
             ON picturelegacy.attachmentid = attachment.attachmentid
      WHERE attachment.userid = ? ORDER BY attachmentid ASC
   `, [ userid ]))[0];

    for (let i = 0; i < rows.length; i++) {
      if (i) bar.tick();

      let row = rows[i];

      let file_mapping = await N.models.vbconvert.FileMapping.findOne()
                                   .where('attachmentid', row.attachmentid)
                                   .lean(true);

      // already imported
      if (file_mapping) continue;

      let media = await add_file(row, user, album_ids);

      if (!media) continue;

      file_mapping = new N.models.vbconvert.FileMapping({
        attachmentid:      row.attachmentid,
        filedataid:        row.filedataid,
        media_id:          media._id
      });

      if (row.blogaid_legacy) {
        file_mapping.blogaid_legacy = row.blogaid_legacy;
      }

      if (row.pictureaid_legacy) {
        file_mapping.pictureaid_legacy = row.pictureaid_legacy;
      }

      await file_mapping.save();
    }

    await N.redis.zadd('vbconvert:files', rows.length, userid);
  }, { concurrency: 100 });

  bar.terminate();
  conn.release();
  await N.redis.del('vbconvert:files');
  N.logger.info('File import finished');
};
