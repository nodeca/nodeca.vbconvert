// Convert posts
//

'use strict';


var async       = require('async');
var mongoose    = require('mongoose');
var ProgressBar = require('progress');


// Get a giant hash { hid: _id } with all registered users
//
function get_user_map(N, callback) {
  N.models.users.User.find()
      .select('hid _id')
      .lean(true)
      .exec(function (err, users) {

    if (err) {
      callback(err);
      return;
    }

    var usermap = {};

    users.forEach(function (user) {
      usermap[user.hid] = user._id;
    });

    callback(null, usermap);
  });
}


module.exports = function (N, callback) {
  /* eslint-disable max-nested-callbacks */
  get_user_map(N, function (err, usermap) {
    if (err) {
      callback(err);
      return;
    }

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

        var bar = new ProgressBar(' filling topics :current/:total [:bar] :percent', {
          complete: '=',
          incomplete: ' ',
          width: 40,
          clear: true,
          total: threads.length,
          renderThrottle: 300
        });

        async.eachSeries(threads, function (thread, next) {
          bar.tick();

          N.models.forum.Topic.findOne({ hid: thread.threadid })
              .select('_id')
              .lean(true)
              .exec(function (err, topic) {

            if (err) {
              next(err);
              return;
            }

            if (!topic) {
              next();
              return;
            }

            conn.query('SELECT pagetext,dateline,ipaddress,userid FROM post ' +
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
                var cache = {
                  post_count: 0
                };

                rows.forEach(function (row, i) {
                  var id = new mongoose.Types.ObjectId(row.dateline);
                  var ts = new Date(row.dateline * 1000);

                  cache.post_count++;

                  if (i === 0) {
                    cache.first_post = id;
                    cache.first_ts   = ts;
                    cache.first_user = usermap[row.userid];
                  }

                  cache.last_post = id;
                  cache.last_ts   = ts;
                  cache.last_user = usermap[row.userid];

                  bulk.insert({
                    _id:    id,
                    topic:  topic._id,
                    hid:    i + 1,
                    ts:     ts,
                    html:   row.pagetext,
                    ip:     row.ipaddress,
                    st:     N.models.forum.Post.statuses.VISIBLE,
                    user:   usermap[row.userid]
                  });
                });

                bulk.execute(function (err) {
                  if (err) {
                    next(err);
                    return;
                  }

                  N.models.forum.Topic.update(
                    { hid: thread.threadid },
                    { $set: {
                      cache: cache,
                      cache_hb: cache,
                      last_post_hid: rows.length
                    } },
                    next
                  );
                });
              });
            });
          });
        }, function (err) {
          bar.terminate();

          if (err) {
            conn.release();
            callback(err);
            return;
          }

          conn.release();
          N.logger.info('Post import finished');
          callback();
        });
      });
    });
  });
};
