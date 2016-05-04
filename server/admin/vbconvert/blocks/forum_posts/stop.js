// Stop post import
//

'use strict';


module.exports = function (N, apiPath) {
  N.validate(apiPath, {});

  N.wire.on(apiPath, function* vbconvert_forum_posts_import_stop() {
    yield N.queue.worker('vbconvert_forum_posts_import').cancel();
  });
};
