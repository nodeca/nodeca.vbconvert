// Stop post import
//

'use strict';


module.exports = function (N, apiPath) {
  N.validate(apiPath, {});

  N.wire.on(apiPath, function vbconvert_forum_posts_stop(env, callback) {
    N.queue.cancel('forum_posts_import', N.queue.worker('forum_posts_import').taskID(), callback);
  });
};
