// Convert files
//

'use strict';

var async    = require('async');
var path     = require('path');
var progress = require('./_progressbar');
var ALBUM    = 8; // content type for albums


module.exports = function (N, callback) {
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

            async.each(rows, function (row, next) {
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

                conn.query('SELECT attachmentid,filedataid,extension,filename,contentid,contenttypeid ' +
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

                      N.models.users.MediaInfo.createFile({
                        album_id: album_ids[row.contenttypeid === ALBUM ? row.contentid : 0].id,
                        user_id:  user._id,
                        name:     row.filename,
                        ext:      row.extension,
                        path:     path.join(N.config.vbconvert.files,
                                            String(userid).split('').join('/'),
                                            row.filedataid + '.attach')
                      }, function (err, media) {
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
