// Convert sections
//

'use strict';

// forum options
const forum_active              = 1;
const forum_allow_posting       = 2;
const forum_can_contain_threads = 4;
const forum_count_posts         = 4096;
const forum_index_posts         = 16384;
const forum_prefix_required     = 131072;


/* eslint-disable no-bitwise */
module.exports = async function (N) {
  let conn = await N.vbconvert.getConnection();
  let store;

  // select all sections except link-only
  let rows = (await conn.query(`
    SELECT forumid,title,description,options,excludable,parentid,displayorder
    FROM forum
    WHERE link = ''
    ORDER BY forumid ASC
  `))[0];

  //
  // Create sections
  //
  await Promise.all(rows.map(async row => {
    // ignoring one inactive forum: vBCms Comments
    if (!(row.options & forum_active)) return;

    let existing_section = await N.models.forum.Section.findOne()
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

    await section.save();
  }));


  //
  // Link each section with its parent
  //
  await Promise.all(rows.map(async row => {
    // top-level forum
    if (row.parentid < 0) return;

    let parent = await N.models.forum.Section.findOne()
                           .where('hid', row.parentid)
                           .lean(true);

    await N.models.forum.Section.update(
      { hid: row.forumid },
      { $set: { parent: parent._id } }
    );
  }));

  await N.models.core.Increment.update(
    { key: 'section' },
    { $set: { value: rows[rows.length - 1].forumid } },
    { upsert: true }
  );

  //
  // Set moderator permissions
  //

  let moderator_permissions = (await conn.query(`
    SELECT userid,forumid
    FROM moderator
  `))[0];

  store = N.settings.getStore('section_moderator');

  if (!store) throw 'Settings store `section_moderator` is not registered.';

  for (let row of moderator_permissions) {
    let section = await N.models.forum.Section.findOne()
                            .where('hid', row.forumid)
                            .lean(true);

    let user = await N.models.users.User.findOne()
                         .where('hid', row.userid)
                         .lean(true);

    if (!section || !user) continue;

    let update = N.config.vbconvert.moderator_permissions;

    await store.set(update, {
      section_id: section._id,
      user_id: user._id
    });
  }

  conn.release();
  N.logger.info('Section import finished');
};
