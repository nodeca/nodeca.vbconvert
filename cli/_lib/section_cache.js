// Create section permissions
//

'use strict';

const co = require('co');


module.exports = co.wrap(function* (N) {
  let conn = yield N.vbconvert.getConnection();

  let forums = yield conn.query('SELECT forumid FROM forum ORDER BY forumid ASC');

  for (let i = 0; i < forums.length; i++) {
    let forum = forums[i];

    let section = yield N.models.forum.Section.findOne()
                            .where('hid', forum.forumid)
                            .lean(true);

    if (!section) continue;

    let results = yield N.models.forum.Topic.aggregate({
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
    }).exec();

    let results_hb = yield N.models.forum.Topic.aggregate({
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
    }).exec();

    yield N.models.forum.Section.update({ _id: section._id }, {
      $set: {
        'cache.topic_count': results.length ? results[0].topics : 0,
        'cache.post_count':  results.length ? results[0].posts  : 0,
        'cache_hb.topic_count': results_hb.length ? results_hb[0].topics : 0,
        'cache_hb.post_count':  results_hb.length ? results_hb[0].posts  : 0
      }
    });

    yield N.models.forum.Section.updateCache(section._id, true);
  }

  conn.release();
  N.logger.info('Section cache built');
});
