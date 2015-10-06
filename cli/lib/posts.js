// Convert posts
//

'use strict';


var async    = require('async');
var mongoose = require('mongoose');


module.exports = function (N, callback) {
  /* not ready yet */
  /* eslint-disable no-unreachable */
  callback();
  return;

  /* eslint-disable max-nested-callbacks */
  N.vbconvert.getConnection(function (err, conn) {
    if (err) {
      callback(err);
      return;
    }

    conn.query('SELECT threadid FROM thread ORDER BY threadid ASC', function (err, threads) {
      if (err) {
        conn.release();
        callback(err);
        return;
      }

      async.eachSeries(threads, function (thread, next) {
        N.models.forum.Topic.findOne({ hid: thread.threadid })
            .select('_id')
            .lean(true)
            .exec(function (err, topic) {

          if (err) {
            next(err);
            return;
          }

          conn.query('SELECT pagetext,dateline,ipaddress FROM post ' +
              'WHERE threadid = ? ORDER BY postid ASC',
              [ thread.threadid ],
              function (err, rows) {

            if (err) {
              next(err);
              return;
            }

            if (rows.length === 0) {
              next();
              return;
            }

            N.models.forum.Post.find({ topic: topic._id }).remove().exec(function (err) {
              if (err) {
                next(err);
                return;
              }

              var bulk = N.models.forum.Post.collection.initializeOrderedBulkOp();

              rows.forEach(function (row, i) {
                bulk.insert({
                  _id:    new mongoose.Types.ObjectId(row.dateline),
                  topic:  topic._id,
                  hid:    i + 1,
                  html:   row.pagetext,
                  ip:     row.ipaddress
                });
              });

              bulk.execute(next);
            });
          });
        });
      }, function (err) {
        if (err) {
          conn.release();
          callback(err);
          return;
        }

        conn.release();
        N.logger.info('Post conversion finished');
        callback();
      });
    });
  });
};
