// Start post import
//

'use strict';


module.exports = function (N, apiPath) {
  N.validate(apiPath, {});

  N.wire.on(apiPath, function vbconvert_forum_posts_stop(env, callback) {
    N.queue.cancel('queue:forum_posts_import:forum_posts_import', callback);
  });
};
