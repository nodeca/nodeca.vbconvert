// Convert usergroups
//

'use strict';

var async = require('async');


module.exports = function (N, callback) {
  N.vbconvert.getConnection(function (err, conn) {
    if (err) {
      callback(err);
      return;
    }

    conn.query('SELECT usergroupid, title FROM usergroup', function (err, rows) {
      if (err) {
        conn.release();
        callback(err);
        return;
      }

      var builtin_groups = Object.keys(N.config.vbconvert.usergroups).map(function (k) {
        return N.config.vbconvert.usergroups[k];
      });

      async.each(rows, function (row, next) {
        if (builtin_groups.indexOf(row.usergroupid) !== -1) {
          next();
          return;
        }

        var usergroup = new N.models.users.UserGroup({
          short_name: row.title,
        });

        usergroup.save(next);

      }, function () {
        if (err) {
          conn.release();
          callback(err);
          return;
        }

        conn.release();
        N.logger.info('UserGroup conversion finished');
        callback();
      });
    });
  });
}
