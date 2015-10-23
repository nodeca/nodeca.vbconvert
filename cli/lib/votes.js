// Import forum votes
//

'use strict';

var async    = require('async');
var mongoose = require('mongoose');
var progress = require('./progressbar');
var POST     = 1; // content type for posts


module.exports = function (N, callback) {
  var users;

  // Get a { hid: { _id, hb } } mapping for all registered users
  //
  function get_users(callback) {
    N.models.users.User.find()
        .select('hid _id hb')
        .lean(true)
        .exec(function (err, userlist) {

      if (err) {
        callback(err);
        return;
      }

      users = {};

      userlist.forEach(function (user) {
        users[user.hid] = user;
      });

      callback();
    });
  }

  /* eslint-disable max-nested-callbacks */
  N.vbconvert.getConnection(function (err, conn) {
    if (err) {
      callback(err);
      return;
    }

    conn.query('SELECT count(*) AS count FROM votes', function (err, rows) {
      if (err) {
        callback(err);
        return;
      }

      var bar = progress(' votes :current/:total [:bar] :percent', rows[0].count);

      conn.query('SELECT fromuserid FROM votes GROUP BY fromuserid ORDER BY fromuserid ASC',
          function (err, userids) {

        if (err) {
          callback(err);
          return;
        }

        get_users(function (err) {
          if (err) {
            callback(err);
            return;
          }

          async.eachLimit(userids, 100, function (row, next) {
            if (!users[row.fromuserid]) {
              // ignore votes casted by deleted users
              next();
              return;
            }

            conn.query('SELECT targetid,vote,fromuserid,touserid,date ' +
                'FROM votes WHERE fromuserid = ? AND contenttypeid = ?',
                [ row.fromuserid, POST ],
                function (err, rows) {

              if (err) {
                next(err);
                return;
              }

              var bulk = N.models.users.Vote.collection.initializeUnorderedBulkOp();
              var count = 0;

              async.eachSeries(rows, function (row, callback) {
                function next() {
                  bar.tick();
                  callback.apply(null, arguments);
                }

                if (err) {
                  next(err);
                  return;
                }

                if (!users[row.touserid]) {
                  // ignore votes casted for deleted users
                  next();
                  return;
                }

                N.models.vbconvert.PostMapping.findOne({ mysql_id: row.targetid })
                    .lean(true)
                    .exec(function (err, post_mapping) {

                  if (err) {
                    next(err);
                    return;
                  }

                  count++;
                  bulk.find({
                    from:  users[row.fromuserid]._id,
                    to:    users[row.touserid]._id,
                    'for': post_mapping.post_id,
                    type:  N.models.users.Vote.types.FORUM_POST
                  }).upsert().update({
                    $setOnInsert: {
                      _id:   new mongoose.Types.ObjectId(row.date),
                      from:  users[row.fromuserid]._id,
                      to:    users[row.touserid]._id,
                      'for': post_mapping.post_id,
                      type:  N.models.users.Vote.types.FORUM_POST,
                      hb:    users[row.fromuserid].hb,
                      value: Number(row.vote)
                    }
                  });

                  next();
                });
              }, function (err) {
                if (err) {
                  next(err);
                  return;
                }

                if (!count) {
                  next();
                  return;
                }

                bulk.execute(next);
              });
            });
          }, function (err) {
            if (err) {
              callback(err);
              return;
            }

            bar.terminate();

            conn.release();
            N.logger.info('Vote import finished');
            callback();
          });
        });
      });
    });
  });
};
