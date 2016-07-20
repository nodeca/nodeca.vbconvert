// Site-specific settings
//

'use strict';

const co = require('bluebird-co').co;

module.exports = co.wrap(function* (N) {
  let conn = yield N.vbconvert.getConnection();
  let store = N.settings.getStore('global');

  if (!store) throw 'Settings store `global` is not registered.';

  //
  // Set abuse report section
  //
  if (N.config.vbconvert.abuse_report_section) {
    let section = yield N.models.forum.Section.findOne()
                            .where('hid', N.config.vbconvert.abuse_report_section)
                            .lean(true);

    yield store.set({ general_abuse_report_section: { value: section._id.toString() } });
  }

  //
  // Set default group after registration
  //
  if (N.config.vbconvert.registered_user_group) {
    let usergroup = yield N.models.users.UserGroup.findOne()
                              .where('short_name', N.config.vbconvert.registered_user_group)
                              .lean(true);

    yield store.set({ registered_user_group: { value: usergroup._id.toString() } });
  }

  conn.release();
});
