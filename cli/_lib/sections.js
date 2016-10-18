// Convert sections
//

'use strict';

const Promise = require('bluebird');

// forum permissions
const can_view_forum             = 1;
const can_post_threads           = 16;
const can_open_close_own_threads = 1024;

// forum options
const forum_active              = 1;
const forum_allow_posting       = 2;
const forum_can_contain_threads = 4;
const forum_count_posts         = 4096;
const forum_index_posts         = 16384;
const forum_prefix_required     = 131072;


/* eslint-disable no-bitwise */
module.exports = Promise.coroutine(function* (N) {
  let conn = yield N.vbconvert.getConnection();
  let store;

  // select all sections except link-only
  let rows = (yield conn.query(`
    SELECT forumid,title,description,options,excludable,parentid,displayorder
    FROM forum
    WHERE link = ''
    ORDER BY forumid ASC
  `))[0];

  //
  // Create sections
  //
  yield Promise.map(rows, Promise.coroutine(function* (row) {
    // ignoring one inactive forum: vBCms Comments
    if (!(row.options & forum_active)) return;

    let existing_section = yield N.models.forum.Section.findOne()
                                     .where('hid', row.forumid)
                                     .lean(true);

    // section with this id is already imported
    if (existing_section) return;

    let section = new N.models.forum.Section();

    section.hid                = row.forumid;
    section.title              = row.title;
    section.description        = row.description;
    section.display_order      = row.displayorder;
    section.is_category        = !(row.options & forum_can_contain_threads);
    section.is_enabled         = true;
    section.is_writable        = !!(row.options & forum_allow_posting);
    section.is_searchable      = !!(row.options & forum_index_posts);
    section.is_votable         = true;
    section.is_counted         = !!(row.options & forum_count_posts);
    section.is_excludable      = !!row.excludable;
    section.is_prefix_required = !!(row.options & forum_prefix_required);

    yield section.save();
  }));


  //
  // Link each section with its parent
  //
  yield Promise.map(rows, Promise.coroutine(function* (row) {
    // top-level forum
    if (row.parentid < 0) return;

    let parent = yield N.models.forum.Section.findOne()
                           .where('hid', row.parentid)
                           .lean(true);

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

  //
  // Set usergroup permissions
  //

  let permissions_by_hid = {};

  (yield conn.query(`
    SELECT forumid,usergroupid,forumpermissions
    FROM forumpermission
  `))[0].forEach(row => {
    permissions_by_hid[row.forumid] = permissions_by_hid[row.forumid] || [];
    permissions_by_hid[row.forumid].push(row);
  });

  store = N.settings.getStore('section_usergroup');

  if (!store) throw 'Settings store `section_usergroup` is not registered.';

  N.models.forum.Section.getChildren.clear();

  for (let section_summary of yield N.models.forum.Section.getChildren()) {
    let section = yield N.models.forum.Section.findOne()
                            .where('_id', section_summary._id)
                            .lean(true);

    for (let row of permissions_by_hid[section.hid] || []) {
      let groupmap = yield N.models.vbconvert.UserGroupMapping.findOne()
                               .where('mysql', row.usergroupid)
                               .lean(true);

      if (!groupmap) continue;

      let settings = yield N.settings.get([
        'forum_can_view',
        'forum_can_reply',
        'forum_can_start_topics',
        'forum_can_close_topic'
      ], {
        usergroup_ids: [ groupmap.mongo ],
        section_id:    section._id
      });

      let should_be = {
        forum_can_view:         !!(row.forumpermissions & can_view_forum),
        forum_can_reply:        !!(row.forumpermissions & can_post_threads),
        forum_can_start_topics: !!(row.forumpermissions & can_post_threads),
        forum_can_close_topic:  !!(row.forumpermissions & can_open_close_own_threads)
      };

      let update = {};

      Object.keys(should_be).forEach(key => {
        if (settings[key] !== should_be[key]) {
          update[key] = { value: should_be[key] };
        }
      });

      if (Object.keys(update).length) {
        yield store.set(update, {
          section_id: section._id,
          usergroup_id: groupmap.mongo
        });
      }
    }
  }

  //
  // Set moderator permissions
  //

  let moderator_permissions = (yield conn.query(`
    SELECT userid,forumid
    FROM moderator
  `))[0];

  store = N.settings.getStore('section_moderator');

  if (!store) throw 'Settings store `section_moderator` is not registered.';

  for (let row of moderator_permissions) {
    let section = yield N.models.forum.Section.findOne()
                            .where('hid', row.forumid)
                            .lean(true);

    let user = yield N.models.users.User.findOne()
                         .where('hid', row.userid)
                         .lean(true);

    if (!section || !user) continue;

    let update = N.config.vbconvert.moderator_permissions;

    yield store.set(update, {
      section_id: section._id,
      user_id: user._id
    });
  }

  conn.release();
  N.logger.info('Section import finished');
});
