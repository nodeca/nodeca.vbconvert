// Stop blog comments import
//

'use strict';


module.exports = function (N, apiPath) {
  N.validate(apiPath, {});

  N.wire.on(apiPath, function vbconvert_blog_comments_import_stop() {
    return N.queue.cancel('vbconvert_blog_comments_import');
  });
};
