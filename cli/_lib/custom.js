// Site-specific settings
//

'use strict';

const _  = require('lodash');


module.exports = async function (N) {
  let store = N.settings.getStore('global');

  if (!store) throw 'Settings store `global` is not registered.';

  //
  // Disable headings in forum posts
  //
  if (N.config.vbconvert.project_name) {
    await store.set({ general_project_name: { value: N.config.vbconvert.project_name } });
  }

  //
  // Set abuse report section
  //
  if (N.config.vbconvert.abuse_report_section) {
    let section = await N.models.forum.Section.findOne()
                            .where('hid', N.config.vbconvert.abuse_report_section)
                            .lean(true);

    await store.set({ general_abuse_report_section: { value: section._id.toString() } });
  }

  //
  // Disable headings in forum posts
  //
  await store.set({ forum_markup_heading: { value: false } });

  //
  // Disable is_searchable flag for market sections
  //
  if (N.config.vbconvert.market_section) {
    let section = await N.models.forum.Section.findOne()
                            .where('hid', N.config.vbconvert.market_section)
                            .lean(true);

    let subsections = await N.models.forum.Section.getChildren(section._id, -1);

    let ids = [ section._id ].concat(_.map(subsections, '_id'));

    await N.models.forum.Section.update(
      { _id: { $in: ids } },
      { $set: { is_searchable: false } },
      { multi: true }
    );
  }

  //
  // Import ban lists
  //
  let conn = await N.vbconvert.getConnection();

  let censorwords = (await conn.query("SELECT value FROM setting WHERE varname='censorwords'"))[0][0].value;

  await store.set({ content_filter_urls: { value: censorwords.replace(/\s+/g, '\n') } });

  let banip = (await conn.query("SELECT value FROM setting WHERE varname='banip'"))[0][0].value;

  await store.set({ ban_ip: { value: banip } });

  let banemail = (await conn.query("SELECT data FROM datastore WHERE title='banemail'"))[0][0].data;

  await store.set({ ban_email: { value: banemail } });
};
