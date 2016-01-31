// Convert sections
//

'use strict';

const co = require('co');


module.exports = co.wrap(function* (N) {
  let conn = yield N.vbconvert.getConnection();

  let rows = yield conn.query(`
    SELECT forumid,title,description,parentid,displayorder
    FROM forum
    ORDER BY forumid ASC
  `);

  //
  // Create sections
  //
  yield rows.map(co.wrap(function* (row) {
    if (N.config.vbconvert.sections &&
        N.config.vbconvert.sections.ignore &&
        N.config.vbconvert.sections.ignore.indexOf(row.forumid) !== -1) {

      return;
    }

    let existing_section = yield N.models.forum.Section.findOne({ hid: row.forumid });

    // section with this id is already imported
    if (existing_section) return;

    let section = new N.models.forum.Section();

    section.hid           = row.forumid;
    section.title         = row.title;
    section.description   = row.description;
    section.display_order = row.displayorder;
    section.is_category   = false;

    yield section.save();
  }));


  //
  // Link each section with its parent
  //
  yield rows.map(co.wrap(function* (row) {
    // top-level forum
    if (row.parentid < 0) return;

    let parent = yield N.models.forum.Section.findOne({ hid: row.parentid });

    yield N.models.forum.Section.update(
      { hid: row.forumid },
      { $set: { parent: parent._id } }
    );

    yield N.models.core.Increment.update(
      { key: 'section' },
      { $set: { value: rows[rows.length - 1].forumid } },
      { upsert: true }
    );
  }));

  conn.release();
  N.logger.info('Section import finished');
});
