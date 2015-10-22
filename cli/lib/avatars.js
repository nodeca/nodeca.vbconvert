// Convert files
//

'use strict';

var _           = require('lodash');
var async       = require('async');
var fs          = require('fs');
var gm          = require('gm');
var path        = require('path');
var progress    = require('./progressbar');
var resizeParse = require('nodeca.users/server/_lib/resize_parse');

// resize_sharp is a drop-in replacement for resize in nodeca.users,
// so you can comment out one or the other to switch between
// gm and sharp libraries
//
var resize = require('nodeca.users/models/users/_lib/resize');
// var resize = require('./resize_sharp');


module.exports = function (N, callback) {
  var config     = resizeParse(N.config.users.avatars);
  var min_width  = _.reduce(config.resize, function (acc, obj) {
    return Math.max(acc, obj.width);
  }, 0);
  var min_height = _.reduce(config.resize, function (acc, obj) {
    return Math.max(acc, obj.height);
  }, 0);

  /* eslint-disable max-nested-callbacks */
  N.vbconvert.getConnection(function (err, conn) {
    if (err) {
      callback(err);
      return;
    }

    conn.query('SELECT userid,width,height,sel_top,sel_left,sel_width,sel_height,bigpicrevision ' +
        'FROM custombigpic JOIN user USING(userid) ' +
        'WHERE bigpicsaved = 1 ORDER BY userid ASC',
        function (err, rows) {

      if (err) {
        callback(err);
        return;
      }

      var bar = progress(' avatars :current/:total [:bar] :percent', rows.length);
      var counter = 0;

      async.eachLimit(rows, 50, function (row, callback) {
        function next() {
          bar.tick();
          callback.apply(null, arguments);
        }

        var tmpfile = '/tmp/vbconvert-' + (++counter) + '.jpg';

        N.models.users.User.findOne({ hid: row.userid })
            .lean(true)
            .exec(function (err, user) {

          if (err) {
            next(err);
            return;
          }

          if (user.avatar_id) {
            // already imported
            next();
            return;
          }

          if (row.sel_width < min_width || row.sel_height < min_height) {
            // 1. avatar removed (both sel_width and sel_height are zero)
            // 2. avatar is too small and we can't scale it up while preserving aspect ratio
            next();
            return;
          }

          gm(path.join(N.config.vbconvert.avatars, String(row.userid) + '_' + row.bigpicrevision + '.jpg'))
            .crop(row.sel_width, row.sel_height, row.sel_left, row.sel_top)
            .write(tmpfile, function (err) {
              if (err) {
                next(err);
                return;
              }

              resize(tmpfile, {
                store:   N.models.core.File,
                ext:     'jpeg',
                maxSize: Infinity,
                resize:  config.types.jpg.resize
              }, function (err, data) {
                if (err) {
                  next(err);
                  return;
                }

                fs.unlink(tmpfile, function (err) {
                  if (err) {
                    next(err);
                    return;
                  }

                  N.models.users.User.update(
                    { hid: row.userid },
                    { avatar_id: data.id },
                    next
                  );
                });
              });
            });
        });
      }, function (err) {
        if (err) {
          callback(err);
          return;
        }

        bar.terminate();

        conn.release();
        N.logger.info('Avatar import finished');
        callback();
      });
    });
  });
};
