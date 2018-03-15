// Add a widget displaying post import progress
//

'use strict';


module.exports = function (N) {
  N.wire.after('server:admin.vbconvert.import_bbcode', { priority: 45 }, async function club_posts_task_widget(env) {
    let task = await N.queue.getTask('vbconvert_club_posts_import');
    let task_info = {};

    if (task && task.state !== 'finished') {
      task_info = {
        current: task.progress,
        total:   task.total
      };
    }

    env.res.blocks.push({ name: 'club_posts', task_info });
  });
};
