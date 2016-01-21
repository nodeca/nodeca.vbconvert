// Create section permissions
//

'use strict';

const co = require('co');


module.exports = co.wrap(function* (N) {
  let SectionUsergroupStore = N.settings.getStore('section_usergroup');

  /* eslint-disable max-nested-callbacks */
  let usergroups = yield N.models.users.UserGroup.find().lean(true);

  let conn = yield N.vbconvert.getConnection();

  let forums = yield conn.query('SELECT forumid FROM forum ORDER BY forumid ASC');

  for (let i = 0; i < forums.length; i++) {
    let forum = forums[i];

    if (N.config.vbconvert.sections &&
        N.config.vbconvert.sections.hide &&
        N.config.vbconvert.sections.hide.indexOf(forum.forumid) === -1) {

      continue;
    }

    let section = yield N.models.forum.Section.findOne({ hid: forum.forumid }).lean(true);

    if (!section) {
      continue;
    }

    let set = {};

    /* eslint-disable no-loop-func */
    usergroups.forEach(function (usergroup) {
      set['data.' + usergroup._id + '.forum_can_view'] = {
        value: false,
        own: true
      };
    });

    yield N.models.forum.SectionUsergroupStore.update(
      { section_id: section._id },
      { $set: set }
    );
  }

  yield SectionUsergroupStore.updateInherited();
  conn.release();
  N.logger.info('Section permissions created');
});
