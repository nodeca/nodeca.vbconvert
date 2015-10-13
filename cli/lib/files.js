// Convert files
//

'use strict';

var async    = require('async');
var path     = require('path');
var progress = require('./_progressbar');


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

          conn.query('SELECT filedataid,extension,filename FROM filedata LEFT JOIN attachment USING(filedataid)' +
              'WHERE filedata.userid = ? ORDER BY filedataid ASC',
              [ userid ],
              function (err, rows) {

            if (err) {
              next(err);
              return;
            }

            async.eachSeries(rows, function (row, next) {
              N.models.users.MediaInfo.createFile({
                album_id: void 0, // TODO
                user_id:  (user || {})._id,
                name:     row.filename,
                ext:      row.extension,
                path:     path.join(N.config.vbconvert.files,
                                    String(userid).split('').join('/'),
                                    row.filedataid + '.attach')
              }, next);
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
