// Stop blog import
//

'use strict';


module.exports = function (N, apiPath) {
  N.validate(apiPath, {});

  N.wire.on(apiPath, function vbconvert_blogs_import_stop() {
    return N.queue.cancel('vbconvert_blogs_import');
  });
};
