// Add a widget displaying blog import progress (entries + comments)
//

'use strict';


module.exports = function (N) {
  N.wire.after('server:admin.vbconvert.import_bbcode', { priority: 40 }, async function blogs_task_widget(env) {
    let task = await N.queue.getTask('vbconvert_blogs_import');
    let task_info = {};

    if (task && task.state !== 'finished') {
      task_info = {
        current: task.progress,
        total:   task.total
      };
    }

    env.res.blocks.push({ name: 'blogs', task_info });
  });
};
