// Add a widget displaying PM import progress
//

'use strict';


module.exports = function (N) {
  N.wire.after('server:admin.vbconvert', { priority: 40 }, function* messages_task_widget(env) {
    let data = yield N.queue.worker('vbconvert_messages_import').status();

    let task_info = {};

    if (data && data.state === 'aggregating') {
      task_info.current = data.chunks.done + data.chunks.errored;
      task_info.total   = data.chunks.done + data.chunks.errored +
                          data.chunks.active + data.chunks.pending;
    }

    env.res.blocks.push({ name: 'messages', task_info });
  });
};