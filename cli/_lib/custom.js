// Site-specific settings
//

'use strict';

const co = require('bluebird-co').co;

module.exports = co.wrap(function* (N) {
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
});
