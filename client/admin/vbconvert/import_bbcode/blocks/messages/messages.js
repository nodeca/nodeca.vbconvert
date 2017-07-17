// Display message import progress in admin interface
//
'use strict';


const ko = require('knockout');


// Knockout bindings root object.
let view = null;
let SELECTOR = '#vbconvert-task-messages';
let finished_tasks = {};


function update_task_status(task_info) {
  if (!view) return;
  if (finished_tasks[task_info.uid]) return;

  if (typeof task_info.current !== 'undefined') {
    view.current(task_info.current);
  }

  if (typeof task_info.total !== 'undefined') {
    view.total(task_info.total);
  }

  if (task_info.finished) {
    view.current(0);
    view.total(1);
    view.started(false);

    finished_tasks[task_info.uid] = true;
  } else {
    view.started(true);
  }
}


N.wire.on('navigate.done:admin.vbconvert.import_bbcode', function messages_task_widget_setup() {
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


N.wire.on('navigate.exit:admin.vbconvert.import_bbcode', function messages_widget_teardown() {
  if (!$(SELECTOR).length) return;

  view = null;
  ko.cleanNode($(SELECTOR)[0]);

  N.live.off('admin.vbconvert.messages', update_task_status);
});


N.wire.once('navigate.done:admin.vbconvert.import_bbcode', function messages_task_widget_setup_handlers() {

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
