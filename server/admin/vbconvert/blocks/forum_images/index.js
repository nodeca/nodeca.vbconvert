// Add a widget displaying image fetch progress
//

'use strict';


module.exports = function (N) {
  N.wire.after('server:admin.vbconvert', { priority: 30 }, function forum_images_task_widget(env, callback) {
    N.queue.worker('vbconvert_forum_images_fetch').status(function (err, data) {
      if (err) {
        callback(err);
        return;
      }

      var task_info = {};

      if (data && data.state === 'aggregating') {
        task_info.current = data.chunks.done + data.chunks.errored;
        task_info.total   = data.chunks.done + data.chunks.errored +
                            data.chunks.active + data.chunks.pending;
      }

      env.res.blocks.push({
        name:      'forum_images',
        task_info: task_info
      });

      callback();
    });
  });
};