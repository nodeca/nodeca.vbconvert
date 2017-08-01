// Start blog import
//

'use strict';


module.exports = function (N, apiPath) {
  N.validate(apiPath, {});

  N.wire.on(apiPath, function vbconvert_blogs_import_start() {
    return N.queue.vbconvert_blogs_import().run();
  });
};
