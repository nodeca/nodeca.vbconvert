// Add a widget displaying post import progress
//

'use strict';


module.exports = function (N) {
  N.wire.after('server:admin.vbconvert', { priority: 20 }, function* forum_posts_task_widget(env) {
    let data = yield N.queue.worker('forum_posts_import').status();

    let task_info = {};

    if (data && data.state === 'aggregating') {
      task_info.current = data.chunks.done + data.chunks.errored;
      task_info.total   = data.chunks.done + data.chunks.errored +
                          data.chunks.active + data.chunks.pending;
    }

    env.res.blocks.push({ name: 'forum_posts', task_info });
  });
};
