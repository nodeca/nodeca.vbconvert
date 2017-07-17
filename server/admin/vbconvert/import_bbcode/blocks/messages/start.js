// Start private message import
//

'use strict';


module.exports = function (N, apiPath) {
  N.validate(apiPath, {});

  N.wire.on(apiPath, function vbconvert_messages_import_start() {
    return N.queue.vbconvert_messages_import().run();
  });
};
