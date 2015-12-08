// Stop post image fetch
//

'use strict';


module.exports = function (N, apiPath) {
  N.validate(apiPath, {});

  N.wire.on(apiPath, function vbconvert_forum_images_fetch_stop(env, callback) {
    N.queue.cancel('vbconvert_forum_images_fetch', N.queue.worker('vbconvert_forum_images_fetch').taskID(), callback);
  });
};
