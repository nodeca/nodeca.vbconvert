// Combined task for importing blogs (entries + comments)
//
'use strict';

const Queue = require('idoit');


module.exports = function (N) {
  N.wire.on('init:jobs', function register_vbconvert_blogs_import() {

    N.queue.registerTask({
      name: 'vbconvert_blogs_import',
      pool: 'hard',
      baseClass: Queue.ChainTemplate,

      // static id to make sure it will never be executed twice at the same time
      taskID: () => 'vbconvert_blogs_import',

      init() {
        return [
          N.queue.vbconvert_blog_entries_import(),
          N.queue.vbconvert_blog_comments_import()
        ];
      }
    });


    N.queue.on('task:progress:vbconvert_blogs_import', function (task_info) {
      N.live.debounce('admin.vbconvert.blogs', {
        uid:     task_info.uid,
        current: task_info.progress,
        total:   task_info.total
      });
    });


    N.queue.on('task:end:vbconvert_blogs_import', function (task_info) {
      N.live.emit('admin.vbconvert.blogs', {
        uid:      task_info.uid,
        finished: true
      });
    });
  });
};
