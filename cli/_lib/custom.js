// Site-specific settings
//

'use strict';

const _  = require('lodash');


module.exports = async function (N) {
  let global_store = N.settings.getStore('global');

  if (!global_store) throw 'Settings store `global` is not registered.';

  //
  // Disable headings in forum posts
  //
  if (N.config.vbconvert.project_name) {
    await global_store.set({ general_project_name: { value: N.config.vbconvert.project_name } });
  }

  //
  // Set abuse report section
  //
  if (N.config.vbconvert.abuse_report_section) {
    let section = await N.models.forum.Section.findOne()
                            .where('hid', N.config.vbconvert.abuse_report_section)
                            .lean(true);

    await global_store.set({ general_abuse_report_section: { value: section._id.toString() } });
  }

  //
  // Disable headings in forum posts
  //
  await global_store.set({ forum_markup_heading: { value: false } });

  //
  // Disable market sections
  //
  if (N.config.vbconvert.market_section) {
    let section = await N.models.forum.Section.findOne()
                            .where('hid', N.config.vbconvert.market_section)
                            .lean(true);

    let subsections = await N.models.forum.Section.getChildren(section._id, -1);

    let ids = [ section._id ].concat(_.map(subsections, '_id'));

    await N.models.forum.Section.updateMany(
      { _id: { $in: ids } },
      { $set: { is_enabled: false, is_searchable: false, is_counted: false } }
    );
  }

  //
  // Import ban lists
  //
  let conn = await N.vbconvert.getConnection();

  let censorwords = (await conn.query("SELECT value FROM setting WHERE varname='censorwords'"))[0][0].value;

  await global_store.set({ content_filter_urls: { value: censorwords.replace(/\s+/g, '\n') } });

  let banip = (await conn.query("SELECT value FROM setting WHERE varname='banip'"))[0][0].value;

  await global_store.set({ ban_ip: { value: banip } });

  let banemail = (await conn.query("SELECT data FROM datastore WHERE title='banemail'"))[0][0].data;

  await global_store.set({ ban_email: { value: banemail } });

  //
  // Set section permissions for usergroups
  //
  let section_store = N.settings.getStore('section_usergroup');

  if (!section_store) throw 'Settings store `section_usergroup` is not registered.';

  let all_usergroups = await N.models.users.UserGroup.find().lean(true);

  async function set_permissions(section_hid, fn) {
    let section = await N.models.forum.Section.findOne()
                            .where('hid').equals(section_hid)
                            .lean(true);

    if (!section) throw `Can't set permissions for section ${section_hid}: section not found`;

    for (let usergroup of all_usergroups) {
      let usergroup_permissions = fn(usergroup);

      if (!usergroup_permissions) continue;

      let settings = await N.settings.get(
        Object.keys(usergroup_permissions),
        {
          usergroup_ids: [ usergroup._id ],
          section_id:    section._id
        }
      );

      let update = {};

      for (let key of Object.keys(usergroup_permissions)) {
        if (settings[key] !== usergroup_permissions[key]) {
          update[key] = { value: usergroup_permissions[key] };
        }
      }

      if (Object.keys(update).length) {
        await section_store.set(update, {
          section_id: section._id,
          usergroup_id: usergroup._id
        });
      }
    }
  }

  // market
  await set_permissions(31, function (usergroup) {
    if (usergroup.short_name === 'novices') {
      return {
        forum_can_view: true,
        forum_can_reply: false,
        forum_can_start_topics: false,
        forum_can_close_topic: false
      };
    }

    if ([ 'administrators', 'moderators', 'members' ].indexOf(usergroup.short_name) !== -1) {
      return {
        forum_can_view: true,
        forum_can_reply: true,
        forum_can_start_topics: true,
        forum_can_close_topic: true
      };
    }

    return {};
  });

  await set_permissions(54, function (usergroup) {
    if (usergroup.short_name === 'novices') {
      return {
        forum_can_view: true,
        forum_can_reply: false,
        forum_can_start_topics: false,
        forum_can_close_topic: false
      };
    }

    return {};
  });

  // internal section
  await set_permissions(102, function (usergroup) {
    if (usergroup.short_name !== 'administrators' && usergroup.short_name !== 'moderators') {
      return {
        forum_can_view: false,
        forum_can_reply: false,
        forum_can_start_topics: false,
        forum_can_close_topic: false
      };
    }

    return {};
  });

  // internal section
  await set_permissions(114, function (usergroup) {
    if (usergroup.short_name !== 'administrators') {
      return {
        forum_can_view: false,
        forum_can_reply: false,
        forum_can_start_topics: false,
        forum_can_close_topic: false
      };
    }

    return {};
  });


  //
  // Set admins as invisible moderators for each section
  // (used to mail abuse reports).
  //
  let SectionModeratorStore = N.settings.getStore('section_moderator');

  if (!SectionModeratorStore) {
    throw new Error('Settings store `section_moderator` is not registered.');
  }

  let moderators = await N.models.users.User.find()
                             .where('hid').in([ 349, 83631 ])
                             .select('_id')
                             .lean(true);

  let top_sections = await N.models.forum.Section.find()
                               .where('parent').equals(null)
                               .select('_id')
                               .lean(true);

  for (let section of top_sections) {
    for (let user of moderators) {
      await SectionModeratorStore.set(
        { forum_mod_visible: { value: false } },
        { section_id: section._id, user_id: user._id }
      );
    }
  }
};
