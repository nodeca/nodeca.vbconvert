// Convert users
//

'use strict';

var async = require('async');


module.exports = function (N, callback) {
  N.models.users.UserGroup.find().lean(true).exec(function (err, usergroups) {
    if (err) {
      callback(err);
      return;
    }

    var id_by_title = {};

    usergroups.forEach(function (usergroup) {
      id_by_title[usergroup.short_name] = usergroup._id;
    });

    N.vbconvert.getConnection(function (err, conn) {
      if (err) {
        callback(err);
        return;
      }

      conn.query('SELECT userid,title,username,email,ipaddress,joindate,lastactivity,posts,field5,field6,title ' +
          'FROM user JOIN userfield USING(`userid`) JOIN usergroup USING(`usergroupid`)', function (err, rows) {

        if (err) {
          conn.release();
          callback(err);
          return;
        }

        var builtin_groups = Object.keys(N.config.vbconvert.usergroups).map(function (k) {
          return N.config.vbconvert.usergroups[k];
        });

        async.each(rows, function (row, next) {
          var user = new N.models.users.User();

          user.hid = row.userid; // does it make sense to save old ids?
          user.nick = row.username;
          user.email = row.email;
          user.joined_ts = new Date(row.joindate * 1000);
          user.joined_ip = row.ipaddress;
          user.last_active_ts = new Date(row.lastactivity * 1000);
          user.post_count = row.posts; // should we re-count it?
          user.usergroups = [ id_by_title[row.title] ];

          user.first_name = row.field5;
          user.last_name = row.field6;

          user.save(next);

        }, function () {
          if (err) {
            conn.release();
            callback(err);
            return;
          }

          conn.release();
          N.logger.info('User conversion finished');
          callback();
        });
      });
    });
  });
}
