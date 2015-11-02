'use strict';


module.exports = function (N, apiPath) {
  N.validate(apiPath, {
  });

  N.wire.on(apiPath, function vbconvert_start(env, callback) {
    N.queue.push('vbconvert_rebuild', callback);
  });
};
