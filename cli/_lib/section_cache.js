// Create section permissions
//

'use strict';

var async = require('async');


module.exports = function (N, callback) {
  /* eslint-disable max-nested-callbacks */
  N.vbconvert.getConnection(function (err, conn) {
    if (err) {
      callback(err);
      return;
    }

    conn.query('SELECT forumid FROM forum ORDER BY forumid ASC', function (err, forums) {
      if (err) {
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

          N.models.forum.Topic.aggregate({
            $match: {
              section: section._id,
              st: { $in: N.models.forum.Topic.statuses.LIST_VISIBLE }
            }
          }, {
            $group: {
              _id: '$section',
              topics: { $sum: 1 },
              posts: { $sum: '$cache.post_count' }
            }
          }, function (err, results) {
            if (err) {
              next(err);
              return;
            }

            N.models.forum.Topic.aggregate({
              $match: {
                section: section._id,
                st: { $in: [ N.models.forum.Topic.statuses.HB ].concat(N.models.forum.Topic.statuses.LIST_VISIBLE) }
              }
            }, {
              $group: {
                _id: '$section',
                topics: { $sum: 1 },
                posts: { $sum: '$cache_hb.post_count' }
              }
            }, function (err, results_hb) {
              if (err) {
                next(err);
                return;
              }

              N.models.forum.Section.update({ _id: section._id }, {
                $set: {
                  'cache.topic_count': results.length ? results[0].topics : 0,
                  'cache.post_count':  results.length ? results[0].posts  : 0,
                  'cache_hb.topic_count': results_hb.length ? results_hb[0].topics : 0,
                  'cache_hb.post_count':  results_hb.length ? results_hb[0].posts  : 0
                }
              }, function (err) {
                if (err) {
                  next(err);
                  return;
                }

                N.models.forum.Section.updateCache(section._id, true, next);
              });
            });
          });
        });
      }, function (err) {
        if (err) {
          callback(err);
          return;
        }

        conn.release();
        N.logger.info('Section cache built');
        callback();
      });
    });
  });
};
