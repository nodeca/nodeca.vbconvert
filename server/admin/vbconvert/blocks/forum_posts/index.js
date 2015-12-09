// Add a widget displaying post import progress
//

'use strict';


module.exports = function (N) {
  N.wire.after('server:admin.vbconvert', { priority: 20 }, function forum_posts_task_widget(env, callback) {
    N.queue.worker('forum_posts_import').status(function (err, data) {
      if (err) {
        callback(err);
        return;
      }

      var task_info = {};

      if (data && data.state === 'aggregating') {
        task_info.current = data.chunks.done.length + data.chunks.errored.length;
        task_info.total   = data.chunks.done.length + data.chunks.errored.length +
                            data.chunks.active.length + data.chunks.pending.length;
      }

      env.res.blocks.push({
        name:      'forum_posts',
        task_info: task_info
      });

      callback();
    });
  });
};
