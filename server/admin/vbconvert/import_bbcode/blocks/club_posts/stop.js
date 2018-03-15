// Stop post import
//

'use strict';


module.exports = function (N, apiPath) {
  N.validate(apiPath, {});

  N.wire.on(apiPath, function vbconvert_club_posts_import_stop() {
    return N.queue.cancel('vbconvert_club_posts_import');
  });
};
