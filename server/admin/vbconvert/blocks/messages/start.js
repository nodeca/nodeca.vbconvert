// Start private message import
//

'use strict';


module.exports = function (N, apiPath) {
  N.validate(apiPath, {});

  N.wire.on(apiPath, function* vbconvert_messages_import_start() {
    yield N.queue.worker('vbconvert_messages_import').push();
  });
};