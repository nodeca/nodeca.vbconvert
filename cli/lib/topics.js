// Convert topics
//

'use strict';


var async    = require('async');
var mongoose = require('mongoose');


module.exports = function (N, callback) {
  /* not ready yet */
  /* eslint-disable no-unreachable */
  callback();
  return;

  var maxid = 0;

  /* eslint-disable max-nested-callbacks */
  N.vbconvert.getConnection(function (err, conn) {
    if (err) {
      callback(err);
      return;
    }

    conn.query('SELECT forumid FROM forum ORDER BY forumid ASC', function (err, forums) {
      if (err) {
        conn.release();
        callback(err);
        return;
      }

      async.eachSeries(forums, function (forum, next) {
        N.models.forum.Section.findOne({ hid: forum.forumid })
            .lean(true)
            .exec(function (err, section) {

          if (err) {
            next(err);
            return;
          }

          if (!section) {
            next();
            return;
          }

          conn.query('SELECT threadid,forumid,title,dateline FROM thread ' +
              'WHERE forumid = ? ORDER BY threadid ASC',
              [ forum.forumid ],
              function (err, rows) {

            if (err) {
              next(err);
              return;
            }

            if (rows.length === 0) {
              next();
              return;
            }

            var bulk = N.models.forum.Topic.collection.initializeUnorderedBulkOp();

            rows.forEach(function (row) {
              if (maxid < row.threadid) { maxid = row.threadid; }

              bulk.find({ hid: row.threadid }).upsert().update({
                $setOnInsert: {
                  _id:      new mongoose.Types.ObjectId(row.dateline),
                  title:    row.title,
                  hid:      row.threadid,
                  section:  section._id,
                  st:       N.models.forum.Topic.statuses.OPEN,
                  cache:    {},
                  cache_hb: {}
                }
              });
            });

            bulk.execute(next);
          });
        });
      }, function (err) {
        if (err) {
          conn.release();
          callback(err);
          return;
        }

        N.models.core.Increment.update(
          { key: 'topic' },
          { $set: { value: maxid } },
          { upsert: true },
          function (err) {
            if (err) {
              callback(err);
              return;
            }

            conn.release();
            N.logger.info('Topic import finished');
            callback();
          }
        );
      });
    });
  });
};
