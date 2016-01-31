// Start post image fetch
//

'use strict';


module.exports = function (N, apiPath) {
  N.validate(apiPath, {});

  N.wire.on(apiPath, function* vbconvert_forum_images_fetch_start() {
    yield N.queue.worker('vbconvert_forum_images_fetch').push();
  });
};
