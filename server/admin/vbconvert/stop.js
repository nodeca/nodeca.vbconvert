'use strict';


module.exports = function (N, apiPath) {
  N.validate(apiPath, {
  });

  N.wire.on(apiPath, function vbconvert_stop(env, callback) {
    N.queue.cancel('queue:vbconvert_rebuild:vbconvert_rebuild', callback);
  });
};
