// Convert files
//

'use strict';

var _           = require('lodash');
var async       = require('async');
var fs          = require('fs');
var mongoose    = require('mongoose');
var path        = require('path');
var progress    = require('./progressbar');
var resizeParse = require('nodeca.users/server/_lib/resize_parse');
var ALBUM       = 8; // content type for albums

// resize_sharp is a drop-in replacement for resize in nodeca.users,
// so you can comment out one or the other to switch between
// gm and sharp libraries
//
var resize = require('nodeca.users/models/users/_lib/resize');
// var resize = require('./resize_sharp');


module.exports = function (N, callback) {
  var mediaConfig = resizeParse(N.config.users.uploads);

  // Chopped-down version of N.models.users.MediaInfo.createFile
  //
  function createFile(filedata, user, album_id, callback) {
    var media    = new N.models.users.MediaInfo();
    var filepath = path.join(N.config.vbconvert.files,
                             String(user.hid).split('').join('/'),
                             filedata.filedataid + '.attach');

    media._id      = new mongoose.Types.ObjectId();
    media.user_id  = user._id;
    media.album_id = album_id;

    var supportedImageFormats = [ 'bmp', 'gif', 'jpg', 'jpeg', 'png' ];

    // Just save if file is not an image
    if (supportedImageFormats.indexOf(filedata.extension) === -1) {
      fs.stat(filepath, function (err, stats) {
        if (err) {
          callback(err);
          return;
        }

        var storeOptions = {
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
          media.media_id  = info.id;
          media.file_size = stats.size;
          media.file_name = filedata.filename;

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

    // copy orig files as is
    resizeConfig.orig.skip_size = Infinity;

    resize(
      filepath,
      {
        store:   N.models.core.File,
        ext:     filedata.extension,
        maxSize: Infinity,
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


  /* eslint-disable max-nested-callbacks */
  N.vbconvert.getConnection(function (err, conn) {
    if (err) {
      callback(err);
      return;
    }

    conn.query('SELECT userid FROM filedata GROUP BY userid ORDER BY userid ASC',
        function (err, userids) {

      if (err) {
        callback(err);
        return;
      }

      var bar = progress(' user files :current/:total [:bar] :percent', userids.length);

      async.eachLimit(userids, 50, function (row, next) {
        var userid = row.userid;

        bar.tick();

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

                conn.query('SELECT attachmentid,filedataid,extension,filename,' +
                    'contentid,contenttypeid,attachment.dateline ' +
                    'FROM filedata LEFT JOIN attachment USING(filedataid) ' +
                    'WHERE filedata.userid = ? ORDER BY filedataid ASC',
                    [ userid ],
                    function (err, rows) {

                  if (err) {
                    next(err);
                    return;
                  }

                  async.eachSeries(rows, function (row, next) {
                    if (err) {
                      next(err);
                      return;
                    }

                    N.models.vbconvert.FileMapping.findOne(
                        { mysql: row.filedataid },
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

                      var albumid = album_ids[row.contenttypeid === ALBUM ? row.contentid : 0].id;

                      createFile(row, user, albumid, function (err, media) {
                        if (err) {
                          next(err);
                          return;
                        }

                        new N.models.vbconvert.FileMapping({
                          mysql: row.filedataid,
                          mongo: media._id
                        }).save(function (err) {
                          if (err) {
                            next(err);
                            return;
                          }

                          var album = album_ids[row.contenttypeid === ALBUM ? row.contentid : 0];

                          if (album.cover !== row.attachmentid) {
                            next();
                            return;
                          }

                          N.models.users.Album.update({ _id: album.id }, {
                            $set: {
                              cover_id: media.media_id
                            }
                          }, function (err) {
                            if (err) {
                              next(err);
                              return;
                            }

                            next();
                          });
                        });
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
};
