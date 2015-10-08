// Convert usergroups
//

'use strict';

var _     = require('lodash');
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

      var mapping = _.invert(N.config.vbconvert.usergroups);

      async.each(rows, function (row, next) {
        if (typeof mapping[row.usergroupid] !== 'undefined') {
          N.models.users.UserGroup.findIdByName(mapping[row.usergroupid], function (err, id) {
            if (err) {
              next(err);
              return;
            }

            new N.models.vbconvert.UserGroupMapping({
              mysql: row.usergroupid,
              mongo: id
            }).save(function (err) {
              // ignore duplicate key errors
              if (err && err.code !== 11000) {
                next(err);
                return;
              }

              next();
            });
          });

          return;
        }

        var usergroup = new N.models.users.UserGroup({
          short_name: row.title
        });

        new N.models.vbconvert.UserGroupMapping({
          mysql: row.usergroupid,
          mongo: usergroup._id
        }).save(function (err) {
          if (err && err.code === 11000) {
            // duplicate key error, means usergroup is already imported
            next();
            return;
          }

          if (err) {
            next(err);
            return;
          }

          usergroup.save(next);
        });

      }, function (err) {
        if (err) {
          conn.release();
          callback(err);
          return;
        }

        conn.release();
        N.logger.info('UserGroup import finished');
        callback();
      });
    });
  });
};
