// Stop private message import
//

'use strict';


module.exports = function (N, apiPath) {
  N.validate(apiPath, {});

  N.wire.on(apiPath, function* vbconvert_messages_import_stop() {
    yield N.queue.cancel('vbconvert_messages_import');
  });
};
