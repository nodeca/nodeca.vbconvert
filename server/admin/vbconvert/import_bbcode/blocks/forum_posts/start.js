// Start post import
//

'use strict';


module.exports = function (N, apiPath) {
  N.validate(apiPath, {});

  N.wire.on(apiPath, function* vbconvert_forum_posts_import_start() {
    yield N.queue.vbconvert_forum_posts_import().run();
  });
};
