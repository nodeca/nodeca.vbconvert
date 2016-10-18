// Add a widget displaying PM import progress
//

'use strict';


module.exports = function (N) {
  N.wire.after('server:admin.vbconvert.import_bbcode', { priority: 40 }, function* messages_task_widget(env) {
    let task = yield N.queue.getTask('vbconvert_messages_import');
    let task_info = {};

    if (task && task.state !== 'finished') {
      task_info = {
        current: task.progress,
        total:   task.total
      };
    }

    env.res.blocks.push({ name: 'messages', task_info });
  });
};
