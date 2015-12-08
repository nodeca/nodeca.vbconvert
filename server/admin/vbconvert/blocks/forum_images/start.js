// Start post image fetch
//

'use strict';


module.exports = function (N, apiPath) {
  N.validate(apiPath, {});

  N.wire.on(apiPath, function vbconvert_forum_images_fetch_start(env, callback) {
    N.queue.push('vbconvert_forum_images_fetch', callback);
  });
};
