// Convert users
//

'use strict';

var async    = require('async');
var mongoose = require('mongoose');
var progress = require('./_progressbar');


module.exports = function (N, callback) {
  /* eslint-disable max-nested-callbacks */
  N.models.vbconvert.UserGroupMapping.find().lean(true).exec(function (err, usergroups) {
    if (err) {
      callback(err);
      return;
    }

    var mongoid = {};

    usergroups.forEach(function (usergroup) {
      mongoid[usergroup.mysql] = usergroup.mongo;
    });

    N.vbconvert.getConnection(function (err, conn) {
      if (err) {
        callback(err);
        return;
      }

      conn.query('SELECT value FROM setting WHERE varname = "globalignore" LIMIT 1',
          function (err, rows) {

        if (err) {
          callback(err);
          return;
        }

        var hellbanned_ids = [];

        if (rows.length) {
          hellbanned_ids = rows[0].value.split(' ').map(Number);
        }

        conn.query('SELECT userid,usergroupid,membergroupids,username,email,' +
            'ipaddress,joindate,lastactivity,posts,field5 as firstname,' +
            'field6 as lastname ' +
            'FROM user JOIN userfield USING(`userid`) ' +
            'ORDER BY userid ASC', function (err, rows) {

          var bar = progress(' users :current/:total [:bar] :percent', rows.length);

          if (err) {
            callback(err);
            return;
          }

          async.eachLimit(rows, 50, function (row, next) {
            bar.tick();

            N.models.users.User.findOne({ hid: row.userid }, function (err, existing_user) {
              if (err) {
                next(err);
                return;
              }

              if (existing_user) {
                // user with this id is already imported
                next();
                return;
              }

              var user = new N.models.users.User();

              user._id = new mongoose.Types.ObjectId(row.joindate);
              user.hid = row.userid;
              user.nick = row.username;
              user.email = row.email;
              user.joined_ts = new Date(row.joindate * 1000);
              user.joined_ip = row.ipaddress;
              user.last_active_ts = new Date(row.lastactivity * 1000);
              user.post_count = row.posts;
              user.first_name = row.firstname;
              user.last_name = row.lastname;
              user.usergroups = [ mongoid[row.usergroupid] ];

              if (row.membergroupids) {
                user.usergroups = user.usergroups.concat(row.membergroupids.split(',').map(function (id) {
                  return mongoid[id];
                }));
              }

              if (hellbanned_ids.indexOf(row.userid) !== -1) {
                user.hb = true;
              }

              user.save(next);
            });
          }, function (err) {
            bar.terminate();

            if (err) {
              callback(err);
              return;
            }

            N.models.core.Increment.update(
              { key: 'user' },
              { $set: { value: rows[rows.length - 1].userid } },
              { upsert: true },
              function (err) {
                if (err) {
                  callback(err);
                  return;
                }

                conn.release();
                N.logger.info('User import finished');
                callback();
              }
            );
          });
        });
      });
    });
  });
};
