// Display post import progress in admin interface
//
'use strict';


var ko = require('knockout');


// Knockout bindings root object.
var view = null;
var SELECTOR = '#vbconvert-task-forum-posts';


function update_task_status(task_info) {
  if (!view) { return; }

  // view.started(task_info.started);
  view.current(task_info.chunks.done + task_info.chunks.errored);
  view.total(task_info.chunks.pending);
}


N.wire.on('navigate.done:admin.vbconvert.index', function vbconvert_forum_post_task_widget_setup() {
  if (!$(SELECTOR).length) { return; }

  view = {
    started: ko.observable(N.runtime.page_data.forum_posts_task.started),
    current: ko.observable(N.runtime.page_data.forum_posts_task.current),
    total:   ko.observable(N.runtime.page_data.forum_posts_task.total)
  };

  ko.applyBindings(view, $(SELECTOR)[0]);

  N.live.on('admin.vbconvert.forum_posts', update_task_status);
});


N.wire.on('navigate.exit:admin.vbconvert.index', function vbconvert_forum_post_task_widget_teardown() {
  if (!$(SELECTOR).length) { return; }

  view = null;
  ko.cleanNode($(SELECTOR)[0]);

  N.live.off('admin.vbconvert.forum_posts', update_task_status);
});


N.wire.once('navigate.done:admin.vbconvert.index', function vbconvert_forum_post_task_widget_setup_handlers() {

  // Click on "start" button
  //
  N.wire.on(module.apiPath + '.start', function vbconvert_start() {
    N.io.rpc(module.apiPath + '.start')
      .done(function () {
        // TODO
        // N.wire.emit('navigate.reload');
        view.started(true);
      });
  });


  // Click on "stop" button
  //
  N.wire.on(module.apiPath + '.stop', function vbconvert_stop() {
    N.io.rpc(module.apiPath + '.stop')
      .done(function () {
        // TODO
        // N.wire.emit('navigate.reload');
        view.started(false);
      });
  });
});
