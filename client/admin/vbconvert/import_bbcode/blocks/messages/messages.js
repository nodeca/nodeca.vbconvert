// Display message import progress in admin interface
//
'use strict';


const ko = require('knockout');


// Knockout bindings root object.
let view = null;
let SELECTOR = '#vbconvert-task-messages';


function update_task_status(task_info) {
  if (!view) return;

  view.current(task_info.current);
  view.total(task_info.total);

  // if task is running, but we're at 100%, set "started: false" because
  // we'll receive no more notifications
  if (task_info.current === task_info.total && task_info.current > 0 && task_info.total > 0) {
    view.started(false);
  } else {
    view.started(true);
  }
}


N.wire.on('navigate.done:admin.vbconvert.import_bbcode', function vbconvert_messages_task_widget_setup() {
  if (!$(SELECTOR).length) return;

  let current = N.runtime.page_data.messages_task.current || 0;
  let total   = N.runtime.page_data.messages_task.total || 1;

  view = {
    started:  ko.observable(current > 0 && current < total),
    current:  ko.observable(current),
    total:    ko.observable(total)
  };

  ko.applyBindings(view, $(SELECTOR)[0]);

  N.live.on('admin.vbconvert.messages', update_task_status);
});


N.wire.on('navigate.exit:admin.vbconvert.import_bbcode', function vbconvert_messages_widget_teardown() {
  if (!$(SELECTOR).length) return;

  view = null;
  ko.cleanNode($(SELECTOR)[0]);

  N.live.off('admin.vbconvert.messages', update_task_status);
});


N.wire.once('navigate.done:admin.vbconvert.import_bbcode', function vbconvert_messages_task_widget_setup_handlers() {

  // Click on "start" button
  //
  N.wire.on(module.apiPath + '.start', function vbconvert_start() {
    N.io.rpc(module.apiPath + '.start').then(() => {
      // reset progress bar to zero
      view.current(0);
      view.total(1);
      view.started(true);
    });
  });


  // Click on "stop" button
  //
  N.wire.on(module.apiPath + '.stop', function vbconvert_stop() {
    N.io.rpc(module.apiPath + '.stop').then(() => {
      // reset progress bar to zero
      view.current(0);
      view.total(1);
      view.started(false);
    });
  });
});
