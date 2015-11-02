// Create section permissions
//

'use strict';

var async = require('async');


module.exports = function (N, callback) {
  var SectionUsergroupStore = N.settings.getStore('section_usergroup');

  /* eslint-disable max-nested-callbacks */
  N.models.users.UserGroup.find().lean(true).exec(function (err, usergroups) {
    if (err) {
      callback(err);
      return;
    }

    N.vbconvert.getConnection(function (err, conn) {
      if (err) {
        callback(err);
        return;
      }

      conn.query('SELECT forumid FROM forum ORDER BY forumid ASC', function (err, forums) {
        if (err) {
          callback(err);
          return;
        }

        async.eachSeries(forums, function (forum, next) {
          if (N.config.vbconvert.sections &&
              N.config.vbconvert.sections.hide &&
              N.config.vbconvert.sections.hide.indexOf(forum.forumid) === -1) {

            next();
            return;
          }

          N.models.forum.Section.findOne({ hid: forum.forumid })
              .lean(true)
              .exec(function (err, section) {

            if (err) {
              next(err);
              return;
            }

            if (!section) {
              next();
              return;
            }

            var set = {};

            usergroups.forEach(function (usergroup) {
              set['data.' + usergroup._id + '.forum_can_view'] = {
                value: false,
                own: true
              };
            });

            N.models.forum.SectionUsergroupStore.update(
              { section_id: section._id },
              { $set: set },
              next
            );
          });
        }, function (err) {
          if (err) {
            callback(err);
            return;
          }

          SectionUsergroupStore.updateInherited(function (err) {
            if (err) {
              callback(err);
              return;
            }

            conn.release();
            N.logger.info('Section permissions created');
            callback();
          });
        });
      });
    });
  });
};
