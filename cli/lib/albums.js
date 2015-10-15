// Convert albums
//

'use strict';

var async    = require('async');
var mongoose = require('mongoose');
var progress = require('./_progressbar');


module.exports = function (N, callback) {
  /* eslint-disable max-nested-callbacks */
  N.vbconvert.getConnection(function (err, conn) {
    if (err) {
      callback(err);
      return;
    }

    conn.query('SELECT userid FROM album GROUP BY userid ORDER BY userid ASC',
        function (err, userids) {

      if (err) {
        callback(err);
        return;
      }

      var bar = progress(' user albums :current/:total [:bar] :percent', userids.length);

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
            // ignore albums belonging to deleted users
            next();
            return;
          }

          conn.query('SELECT albumid,title,description,createdate,lastpicturedate ' +
              'FROM album WHERE userid = ? ORDER BY albumid ASC',
              [ userid ],
              function (err, rows) {

            if (err) {
              next(err);
              return;
            }

            async.eachSeries(rows, function (row, next) {
              N.models.vbconvert.AlbumMapping.findOne(
                  { mysql: row.albumid },
                  function (err, album_mapping) {

                if (err) {
                  next(err);
                  return;
                }

                if (album_mapping) {
                  // already imported
                  next();
                  return;
                }

                conn.query('SELECT dateline ' +
                    'FROM attachment WHERE contenttypeid = 8 AND contentid = ? ' +
                    'ORDER BY dateline ASC',
                    [ rows.albumid ],
                    function (err, datelines) {

                  if (err) {
                    next(err);
                    return;
                  }

                  datelines = datelines || [];

                  var album = new N.models.users.Album();

                  album.title       = row.title;
                  album.description = row.description;
                  album.user_id     = user._id;

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

                  album.count = datelines.length;

                  new N.models.vbconvert.AlbumMapping({
                    mysql: row.albumid,
                    mongo: album._id
                  }).save(function (err) {
                    if (err) {
                      next(err);
                      return;
                    }

                    album.save(next);
                  });
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
        N.logger.info('Album import finished');
        callback();
      });
    });
  });
};
