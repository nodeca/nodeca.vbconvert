// Add a widget displaying blog comment import progress
//

'use strict';


module.exports = function (N) {
  N.wire.after('server:admin.vbconvert.import_bbcode', { priority: 40 }, async function blog_comments_task_widget(env) {
    let task = await N.queue.getTask('vbconvert_blog_comments_import');
    let task_info = {};

    if (task && task.state !== 'finished') {
      task_info = {
        current: task.progress,
        total:   task.total
      };
    }

    env.res.blocks.push({ name: 'blog_comments', task_info });
  });
};
