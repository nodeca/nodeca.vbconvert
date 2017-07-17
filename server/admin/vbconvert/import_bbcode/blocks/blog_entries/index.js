// Add a widget displaying blog entry import progress
//

'use strict';


module.exports = function (N) {
  N.wire.after('server:admin.vbconvert.import_bbcode', { priority: 30 }, async function blog_entries_task_widget(env) {
    let task = await N.queue.getTask('vbconvert_blog_entries_import');
    let task_info = {};

    if (task && task.state !== 'finished') {
      task_info = {
        current: task.progress,
        total:   task.total
      };
    }

    env.res.blocks.push({ name: 'blog_entries', task_info });
  });
};
