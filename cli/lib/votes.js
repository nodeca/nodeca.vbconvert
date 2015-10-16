// Import forum votes
//

'use strict';

var async    = require('async');
var mongoose = require('mongoose');
var progress = require('./_progressbar');
var POST     = 1; // content type for posts


module.exports = function (N, callback) {
  /* eslint-disable max-nested-callbacks */
  N.vbconvert.getConnection(function (err, conn) {
    if (err) {
      callback(err);
      return;
    }

    conn.query('SELECT fromuserid FROM votes GROUP BY fromuserid ORDER BY fromuserid ASC',
        function (err, userids) {

      if (err) {
        callback(err);
        return;
      }

      var bar = progress(' voters :current/:total [:bar] :percent', userids.length);

      async.eachLimit(userids, 50, function (row, next) {
        var userid = row.fromuserid;

        bar.tick();

        N.models.users.User.findOne({ hid: userid })
            .lean(true)
            .exec(function (err, user) {

          if (err) {
            next(err);
            return;
          }

          if (!user) {
            // ignore votes casted by deleted users
            next();
            return;
          }

          conn.query('SELECT targetid,vote,touserid,date ' +
              'FROM votes WHERE fromuserid = ? AND contenttypeid = ?',
              [ userid, POST ],
              function (err, rows) {

            if (err) {
              next(err);
              return;
            }

            var bulk = N.models.users.Vote.collection.initializeUnorderedBulkOp();
            var count = 0;

            async.eachSeries(rows, function (row, next) {
              N.models.users.User.findOne({ hid: row.touserid })
                  .lean(true)
                  .exec(function (err, touser) {

                if (err) {
                  next(err);
                  return;
                }

                if (!touser) {
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
                    from:  user._id,
                    to:    touser._id,
                    'for': post_mapping.post_id,
                    type:  N.models.users.Votes.types.FORUM_POST
                  }).upsert().update({
                    $setOnInsert: {
                      _id:   new mongoose.Types.ObjectId(row.date),
                      from:  user._id,
                      to:    touser._id,
                      'for': post_mapping.post_id,
                      type:  N.models.users.Votes.types.FORUM_POST,
                      hb:    user.hb,
                      value: row.vote
                    }
                  });
                });
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
