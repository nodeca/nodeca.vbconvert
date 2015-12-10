// Convert files
//

'use strict';

var _           = require('lodash');
var async       = require('async');
var fs          = require('fs');
var mimoza      = require('mimoza');
var mongoose    = require('mongoose');
var path        = require('path');
var progress    = require('./progressbar');
var resize      = require('./resize');
var resizeParse = require('nodeca.users/server/_lib/resize_parse');
var ALBUM       = 8; // content type for albums
var POST        = 1; // content type for posts


module.exports = function (N, callback) {
  var mediaConfig = resizeParse(N.config.users.uploads);

  // Chopped-down version of N.models.users.MediaInfo.createFile
  //
  function create_file(filedata, filepath, user, album_id, callback) {
    var media = new N.models.users.MediaInfo();

    media._id         = new mongoose.Types.ObjectId(filedata.dateline);
    media.user_id     = user._id;
    media.album_id    = album_id;
    media.ts          = new Date(filedata.dateline * 1000);
    media.file_name   = filedata.filename;
    media.description = filedata.caption;

    var supportedImageFormats = [ 'bmp', 'gif', 'jpg', 'jpeg', 'png' ];

    // Just save if file is not an image
    if (supportedImageFormats.indexOf(filedata.extension) === -1) {
      fs.stat(filepath, function (err, stats) {
        if (err) {
          callback(err);
          return;
        }

        var storeOptions = {
          _id: new mongoose.Types.ObjectId(filedata.dateline),
          contentType: mimoza.getMimeType(filedata.extension),
          metadata: {
            origName: filedata.filename
          }
        };

        N.models.core.File.put(filepath, storeOptions, function (err, info) {
          if (err) {
            callback(err);
            return;
          }

          media.type      = N.models.users.MediaInfo.types.BINARY;
          media.media_id  = info._id;
          media.file_size = stats.size;

          media.save(function (err) {
            if (err) {
              callback(err);
              return;
            }

            callback(null, media);
          });
        });
      });

      return;
    }

    var resizeConfig = _.cloneDeep(mediaConfig.types[filedata.extension].resize);

    resizeConfig.orig.skip_size = Infinity;

    resize(
      filepath,
      {
        store:   N.models.core.File,
        ext:     filedata.extension,
        date:    filedata.dateline,
        resize:  resizeConfig
      },
      function (err, data) {
        if (err) {
          callback(err);
          return;
        }

        media.type        = N.models.users.MediaInfo.types.IMAGE;
        media.image_sizes = data.images;
        media.media_id    = data.id;
        media.file_size   = data.size;

        media.save(function (err) {
          if (err) {
            callback(err);
            return;
          }

          callback(null, media);
        });
      }
    );
  }


  // Create file, add it to album and add it to post if necessary
  //
  function add_file(row, user, album_ids, callback) {
    var albumid = album_ids[row.contenttypeid === ALBUM ? row.contentid : 0].id;
    var filepath = path.join(N.config.vbconvert.files,
          String(row.filedataowner).split('').join('/'),
          row.filedataid + '.attach');

    create_file(row, filepath, user, albumid, function (err, media) {
      if (err) {
        // some files are considered corrupted by gm, we should log those
        N.logger.warn('File import: ' + err.message + ' (processing ' + filepath + ')');
        callback();
        return;
      }

      N.models.users.UserExtra.update(
          { user_id: media.user_id },
          { $inc: { media_size: media.file_size } },
          function (err) {

        if (err) {
          callback(err);
          return;
        }

        var album = album_ids[row.contenttypeid === ALBUM ? row.contentid : 0];

        var updateData = { $inc: { count: 1 } };

        // only set cover if:
        //  1. cover info doesn't exist in mysql (last image will be the cover)
        //  2. cover exist and is equal to current row
        if (!album.cover || album.cover === row.attachmentid) {
          updateData.$set = { cover_id: media.media_id };
        }

        N.models.users.Album.update({ _id: album.id }, updateData, function (err) {
          if (err) {
            callback(err);
            return;
          }

          if (row.contenttypeid !== POST) {
            callback(null, media);
            return;
          }

          N.models.vbconvert.PostMapping.findOne({ mysql_id: row.contentid })
              .lean(true)
              .exec(function (err, postmapping) {

            if (err) {
              callback(err);
              return;
            }

            if (!postmapping) {
              callback(null, media);
              return;
            }

            N.models.forum.Post.update(
              { _id: postmapping.post_id },
              { $push: { attach: media.media_id } },
              function (err) {
                if (err) {
                  callback(err);
                  return;
                }

                callback(null, media);
              }
            );
          });
        });
      });
    });
  }


  /* eslint-disable max-nested-callbacks */
  N.vbconvert.getConnection(function (err, conn) {
    if (err) {
      callback(err);
      return;
    }

    conn.query('SELECT count(*) AS count FROM attachment', function (err, rows) {
      if (err) {
        callback(err);
        return;
      }

      var bar = progress(' files :current/:total [:bar] :percent', rows[0].count);

      conn.query('SELECT userid FROM attachment GROUP BY userid ORDER BY userid ASC',
          function (err, userids) {

        if (err) {
          callback(err);
          return;
        }

        async.eachLimit(userids, 100, function (row, next) {
          var userid = row.userid;

          N.models.users.User.findOne({ hid: userid })
              .lean(true)
              .exec(function (err, user) {

            if (err) {
              next(err);
              return;
            }

            if (!user) {
              // ignore content owned by deleted users
              next();
              return;
            }

            conn.query('SELECT albumid,coverattachmentid ' +
               'FROM album WHERE userid = ? ORDER BY albumid ASC',
                [ userid ],
                function (err, rows) {

              if (err) {
                next(err);
                return;
              }

              var album_ids = {};

              async.eachSeries(rows, function (row, next) {
                N.models.vbconvert.AlbumMapping.findOne(
                    { mysql: row.albumid },
                    function (err, album_mapping) {

                  if (err) {
                    next(err);
                    return;
                  }

                  album_ids[album_mapping.mysql] = {
                    id: album_mapping.mongo,
                    cover: row.coverattachmentid
                  };

                  next();
                });
              }, function (err) {
                if (err) {
                  next(err);
                  return;
                }

                N.models.users.Album.findOne(
                    { user_id: user._id, 'default': true },
                    function (err, def_album) {

                  if (err) {
                    next(err);
                    return;
                  }

                  album_ids[0] = { id: def_album._id };

                  conn.query('SELECT filedata.userid AS filedataowner,' +
                      'filedataid,attachmentid,extension,filename,caption,' +
                      'contentid,contenttypeid,attachment.dateline ' +
                      'FROM filedata JOIN attachment USING(filedataid) ' +
                      'WHERE attachment.userid = ? ORDER BY attachmentid ASC',
                      [ userid ],
                      function (err, rows) {

                    if (err) {
                      next(err);
                      return;
                    }

                    async.eachSeries(rows, function (row, callback) {
                      function next() {
                        bar.tick();
                        callback.apply(null, arguments);
                      }

                      if (err) {
                        next(err);
                        return;
                      }

                      N.models.vbconvert.FileMapping.findOne(
                          { mysql: row.attachmentid },
                          function (err, file_mapping) {

                        if (err) {
                          next(err);
                          return;
                        }

                        if (file_mapping) {
                          // already imported
                          next();
                          return;
                        }

                        add_file(row, user, album_ids, function (err, media) {
                          if (err) {
                            next(err);
                            return;
                          }

                          if (!media) {
                            next();
                            return;
                          }

                          new N.models.vbconvert.FileMapping({
                            mysql: row.attachmentid,
                            mongo: media._id
                          }).save(next);
                        });
                      });
                    }, next);
                  });
                });
              }, next);
            });
          });
        }, function (err) {
          if (err) {
            callback(err);
            return;
          }

          bar.terminate();

          conn.release();
          N.logger.info('File import finished');
          callback();
        });
      });
    });
  });
};
