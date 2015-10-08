// Convert sections
//

'use strict';

var async = require('async');


module.exports = function (N, callback) {
  N.vbconvert.getConnection(function (err, conn) {
    if (err) {
      callback(err);
      return;
    }

    conn.query('SELECT forumid,title,description,parentid,displayorder FROM forum ORDER BY forumid ASC',
        function (err, rows) {

      if (err) {
        conn.release();
        callback(err);
        return;
      }

      // Create sections
      //
      async.each(rows, function (row, next) {
        if (N.config.vbconvert.sections &&
            N.config.vbconvert.sections.ignore &&
            N.config.vbconvert.sections.ignore.indexOf(row.forumid) !== -1) {

          next();
          return;
        }

        N.models.forum.Section.findOne({ hid: row.forumid }, function (err, existing_section) {
          if (err) {
            next(err);
            return;
          }

          if (existing_section) {
            // section with this id is already imported
            next();
            return;
          }

          var section = new N.models.forum.Section();

          section.hid           = row.forumid;
          section.title         = row.title;
          section.description   = row.description;
          section.display_order = row.displayorder;
          section.is_category   = false;

          section.save(next);
        });
      }, function (err) {
        if (err) {
          conn.release();
          callback(err);
          return;
        }

        // Link each section with its parent
        //
        async.each(rows, function (row, next) {
          if (row.parentid < 0) {
            // top-level forum
            next();
            return;
          }

          N.models.forum.Section.findOne({ hid: row.parentid }, function (err, parent) {
            if (err) {
              next(err);
              return;
            }

            N.models.forum.Section.update(
              { hid: row.forumid },
              { $set: { parent: parent._id } },
              next
            );
          });
        }, function (err) {
          if (err) {
            conn.release();
            callback(err);
            return;
          }

          N.models.core.Increment.update(
            { key: 'section' },
            { $set: { value: rows[rows.length - 1].forumid } },
            { upsert: true },
            function (err) {
              if (err) {
                conn.release();
                callback(err);
                return;
              }

              conn.release();
              N.logger.info('Section import finished');
              callback();
            }
          );
        });
      });
    });
  });
};
