// Stop post image fetch
//

'use strict';


module.exports = function (N, apiPath) {
  N.validate(apiPath, {});

  N.wire.on(apiPath, function vbconvert_forum_images_fetch_stop(env, callback) {
    N.queue.worker('vbconvert_forum_images_fetch').cancel(callback);
  });
};
