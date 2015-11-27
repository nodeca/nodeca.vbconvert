// Add a widget displaying post import progress
//

'use strict';


module.exports = function (N) {
  N.wire.after('server:admin.vbconvert.index', function forum_posts_task_widget(env, callback) {
    N.queue.status('queue:forum_posts_import:forum_posts_import', function (err, data) {
      if (err) {
        callback(err);
        return;
      }

      var task_info = {};

      if (data && data.state === 'aggregating') {
        task_info.current = data.chunks.done.length + data.chunks.errored.length;
        task_info.total   = data.chunks.done.length + data.chunks.errored.length +
                            data.chunks.active.length + data.chunks.pending.length;
      } else if (data && data.state === 'reducing') {
        // show 100%
        task_info.current = 1;
        task_info.total   = 1;
      } else {
        // show 0%
        task_info.current = 0;
        task_info.total   = 1;
      }

      task_info.started = !!data;

      env.res.blocks.push({
        name:      'forum_posts',
        task_info: task_info
      });

      callback();
    });
  });
};
