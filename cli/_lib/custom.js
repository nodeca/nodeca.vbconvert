// Site-specific settings
//

'use strict';

const _       = require('lodash');
const Promise = require('bluebird');


module.exports = Promise.coroutine(function* (N) {
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
  // Disable headings in forum posts
  //
  yield store.set({ forum_markup_heading: { value: false } });

  //
  // Disable is_searchable flag for market sections
  //
  if (N.config.vbconvert.market_section) {
    let section = yield N.models.forum.Section.findOne()
                            .where('hid', N.config.vbconvert.market_section)
                            .lean(true);

    let subsections = yield N.models.forum.Section.getChildren(section._id, -1);

    let ids = [ section._id ].concat(_.map(subsections, '_id'));

    yield N.models.forum.Section.update(
      { _id: { $in: ids } },
      { $set: { is_searchable: false } },
      { multi: true }
    );
  }
});
