// Display post import progress in admin interface
//
'use strict';


var ko = require('knockout');


// Knockout bindings root object.
var view = null;
var SELECTOR = '#vbconvert-task-forum-posts';
var finished_tasks = {};


function update_task_status(task_info) {
  if (!view) { return; }

  if (finished_tasks[task_info.taskid]) {
    // task is finished, but we're still receiving debounced messages
    return;
  }

  view.started(!!task_info.started);
  view.current(task_info.current);
  view.total(task_info.total);

  if (task_info.finished) {
    finished_tasks[task_info.taskid] = true;
  }
}


N.wire.on('navigate.done:admin.vbconvert.index', function vbconvert_forum_post_task_widget_setup() {
  if (!$(SELECTOR).length) { return; }

  view = {
    started:  ko.observable(N.runtime.page_data.forum_posts_task.started),
    current:  ko.observable(N.runtime.page_data.forum_posts_task.current),
    total:    ko.observable(N.runtime.page_data.forum_posts_task.total),
    finished: ko.computed(function () {
      return false;

      // TODO
      //return !this.started() && Object.keys(finished_tasks).length > 0;
    }, view)
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
        view.started(true);
      });
  });


  // Click on "stop" button
  //
  N.wire.on(module.apiPath + '.stop', function vbconvert_stop() {
    N.io.rpc(module.apiPath + '.stop')
      .done(function () {
        view.started(false);
      });
  });
});
