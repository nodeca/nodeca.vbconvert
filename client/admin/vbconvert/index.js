
'use strict';


// Click on "start" button
//
N.wire.on('admin.vbconvert.start', function vbconvert_start() {
  N.io.rpc('admin.vbconvert.start')
    .done(function () {
      N.wire.emit('navigate.reload');
    })
    .fail(function (err) {
      N.wire.emit('notify', { type: 'error', message: err.message });
    });
});


// Click on "stop" button
//
N.wire.on('admin.vbconvert.stop', function vbconvert_stop() {
  N.io.rpc('admin.vbconvert.stop')
    .done(function () {
      N.wire.emit('navigate.reload');
    })
    .fail(function (err) {
      N.wire.emit('notify', { type: 'error', message: err.message });
    });
});
