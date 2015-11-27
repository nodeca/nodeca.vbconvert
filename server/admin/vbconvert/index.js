
'use strict';


module.exports = function (N, apiPath) {
  N.validate(apiPath, {});

  N.wire.on(apiPath, function vbconvert_index(env) {
    env.res.head.title = env.t('title');
    env.res.blocks = [];
  });
};
