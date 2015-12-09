// Start post import
//

'use strict';


module.exports = function (N, apiPath) {
  N.validate(apiPath, {});

  N.wire.on(apiPath, function vbconvert_forum_posts_start(env, callback) {
    N.queue.worker('forum_posts_import').push(callback);
  });
};
