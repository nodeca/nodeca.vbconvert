
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
