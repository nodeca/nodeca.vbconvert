
'use strict';

var _ = require('lodash');


module.exports = function (N, apiPath) {
  N.validate(apiPath, {
  });

  N.wire.on(apiPath, function vbconvert_index(env, callback) {
    N.queue.status('queue:vbconvert_rebuild:vbconvert_rebuild', function (err, data) {
      if (err) {
        callback(err);
        return;
      }

      if (data) {
        env.res.task_info = {};
        env.res.task_info.state = data.state;
        env.res.task_info.chunks = _.mapValues(data.chunks, function (arr) {
          return arr.length;
        });
      }

      callback();
    });
  });
};
