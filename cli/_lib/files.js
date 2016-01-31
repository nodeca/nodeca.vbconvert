// Convert files
//

'use strict';

const _           = require('lodash');
const Promise     = require('bluebird');
const co          = require('co');
const fs          = require('mz/fs');
const mime        = require('mime-types').lookup;
const mongoose    = require('mongoose');
const path        = require('path');
const progress    = require('./utils').progress;
const resize      = require('nodeca.users/models/users/_lib/resize');
const resizeParse = require('nodeca.users/server/_lib/resize_parse');
const ALBUM       = 8; // content type for albums
const POST        = 1; // content type for posts


module.exports = co.wrap(function* (N) {
  let mediaConfig = resizeParse(N.config.users.uploads);

  // Chopped-down version of N.models.users.MediaInfo.createFile
  //
  const create_file = co.wrap(function* (filedata, filepath, user, album_id) {
    let media = new N.models.users.MediaInfo();

    media._id         = new mongoose.Types.ObjectId(filedata.dateline);
    media.user_id     = user._id;
    media.album_id    = album_id;
    media.ts          = new Date(filedata.dateline * 1000);
    media.file_name   = filedata.filename;
    media.description = filedata.caption;

    let supportedImageFormats = [ 'bmp', 'gif', 'jpg', 'jpeg', 'png' ];

    // Just save if file is not an image
    if (supportedImageFormats.indexOf(filedata.extension) === -1) {
      let stats = yield fs.stat(filepath);

      let storeOptions = {
        _id: new mongoose.Types.ObjectId(filedata.dateline),
        contentType: mime(filedata.extension),
        metadata: {
          origName: filedata.filename
        }
      };

      let info = yield N.models.core.File.put(filepath, storeOptions);

      media.type      = N.models.users.MediaInfo.types.BINARY;
      media.media_id  = info._id;
      media.file_size = stats.size;
    } else {
      let resizeConfig = _.cloneDeep(mediaConfig.types[filedata.extension].resize);

      resizeConfig.orig.skip_size = Infinity;

      let data = yield resize(
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

    yield media.save();
    return media;
  });


  // Create file, add it to album and add it to post if necessary
  //
  const add_file = co.wrap(function* add_file(row, user, album_ids) {
    let albumid = album_ids[row.contenttypeid === ALBUM ? row.contentid : 0].id;
    let filepath = path.join(N.config.vbconvert.files,
          String(row.filedataowner).split('').join('/'),
          row.filedataid + '.attach');

    let media;

    try {
      media = yield create_file(row, filepath, user, albumid);
    } catch (err) {
      // some files are considered corrupted by gm, we should log those
      N.logger.warn('File import: ' + err.message + ' (processing ' + filepath + ')');
      return null;
    }

    yield N.models.users.UserExtra.update(
      { user_id: media.user_id },
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

    yield N.models.users.Album.update({ _id: album.id }, updateData);

    if (row.contenttypeid === POST) {
      let postmapping = yield N.models.vbconvert.PostMapping.findOne({ mysql_id: row.contentid }).lean(true);

      if (postmapping) {
        yield N.models.forum.Post.update(
          { _id: postmapping.post_id },
          { $push: { attach: media.media_id } }
        );
      }
    }

    return media;
  });


  const conn = yield N.vbconvert.getConnection();

  let rows = yield conn.query('SELECT count(*) AS count FROM attachment');

  let bar = progress(' files :current/:total [:bar] :percent', rows[0].count);

  let userids = yield conn.query('SELECT userid FROM attachment GROUP BY userid ORDER BY userid ASC');

  yield Promise.map(userids, co.wrap(function* (row) {
    let rows;
    let userid = row.userid;

    let user = yield N.models.users.User.findOne({ hid: userid }).lean(true);

    // ignore content owned by deleted users
    if (!user) return;

    rows = yield conn.query(`
      SELECT albumid,coverattachmentid
      FROM album WHERE userid = ? ORDER BY albumid ASC
    `, [ userid ]);

    let album_ids = {};

    for (let i = 0; i < rows.length; i++) {
      let row = rows[i];

      let album_mapping = yield N.models.vbconvert.AlbumMapping.findOne(
                                  { mysql: row.albumid }
                                );

      album_ids[album_mapping.mysql] = {
        id: album_mapping.mongo,
        cover: row.coverattachmentid
      };
    }

    let def_album = yield N.models.users.Album.findOne(
                            { user_id: user._id, 'default': true }
                          );

    album_ids[0] = { id: def_album._id };

    rows = yield conn.query(`
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
   `, [ userid ]);

    for (let i = 0; i < rows.length; i++) {
      if (i) bar.tick();

      let row = rows[i];

      let file_mapping = yield N.models.vbconvert.FileMapping.findOne(
                                 { attachmentid: row.attachmentid }
                               );

      // already imported
      if (file_mapping) continue;

      let media = yield add_file(row, user, album_ids);

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

      yield file_mapping.save();
    }

    bar.tick();
  }), { concurrency: 100 });

  bar.terminate();
  conn.release();
  N.logger.info('File import finished');
});
