// Import blog entries
//

'use strict';


const _             = require('lodash');
const mongoose      = require('mongoose');
const memoize       = require('promise-memoize');
const html_unescape = require('./utils').html_unescape;
const progress      = require('./utils').progress;

// blog options
const blog_private = 8;


module.exports = async function (N) {
  let conn = await N.vbconvert.getConnection();

  let blogids = _.map((await conn.query('SELECT blogid FROM blog ORDER BY blogid ASC'))[0], 'blogid');

  let category_titles = {};

  for (let c of (await conn.query('SELECT blogcategoryid,title FROM blog_category'))[0]) {
    category_titles[c.blogcategoryid] = html_unescape(c.title).replace(/,/g, ' ');
  }

  let bar = progress(' blog entries :current/:total :percent', blogids.length);

  const get_user_by_hid = memoize(function (hid) {
    return N.models.users.User.findOne({ hid }).lean(true);
  });

  const get_default_usergroup = memoize(function () {
    return N.models.users.UserGroup.findOne({ short_name: 'members' }).lean(true);
  });

  const get_parser_param_id = memoize(function (usergroup_ids, allowsmilie) {
    return N.settings.getByCategory(
      'blog_entries',
      { usergroup_ids },
      { alias: true }
    ).then(params => {
      // make sure quotes are not collapsed in imported messages
      params.quote_collapse = false;

      if (!allowsmilie) {
        params.emoji = false;
      }

      return N.models.core.MessageParams.setParams(params);
    });
  });

  // title       - tag/category title
  // user_id     - user id
  // dateline    - post dateline (tags are created with the first post they're in)
  // category_id - blogcategoryid in mysql, null for tags
  const create_tag = memoize(async function (title, user_id, dateline, category_id) {
    title = title.trim().toLowerCase().replace(/\s+/, ' ').replace(/^\s+|\s+$/g, '');

    let existing_tag = await N.models.blogs.BlogTag.findOne()
                                 .where('user').equals(user_id)
                                 .where('name').equals(title)
                                 .where('is_category').equals(category_id ? true : false)
                                 .lean(true);

    if (existing_tag) return existing_tag.hid;

    let new_tag = await new N.models.blogs.BlogTag({
      _id: new mongoose.Types.ObjectId(dateline),
      name: title,
      user: user_id,
      is_category: category_id ? true : false
    }).save();

    if (category_id) {
      await new N.models.vbconvert.BlogCategoryMapping({
        mysql: category_id,
        mongo: new_tag._id
      }).save();
    }

    return new_tag.hid;
  });

  for (let blogid of blogids) {
    bar.tick();

    let row = (await conn.query(`
      SELECT blog.blogid,blog.userid,blog.dateline,blog.pending,blog.state,
             blog.title,blog.taglist,blog.categories,blog.views,
             blog_text.blogtextid,blog_text.ipaddress,blog_text.pagetext,
             blog_text.allowsmilie
      FROM blog JOIN blog_text USING(blogid)
      WHERE blog.firstblogtextid = blog_text.blogtextid
        AND blogid = ?
    `, [ blogid ]))[0][0];

    let existing_mapping = await N.models.vbconvert.BlogTextMapping.findOne()
                                     .where('blogtextid').equals(row.blogtextid)
                                     .lean(true);

    // blog entry with this id is already imported
    if (existing_mapping) continue;

    let user = await get_user_by_hid(row.userid);
    let user_id = user ? user._id : new mongoose.Types.ObjectId('000000000000000000000000');

    if (user && !user.active) {
      user.active = true;

      await N.models.users.User.update({ _id: user._id }, { $set: { active: true } });
    }

    let params_id = await get_parser_param_id(
      (user && user.usergroups) ? user.usergroups : [ (await get_default_usergroup())._id ],
      row.allowsmilie
    );

    // old blog posts (before 2009) have html characters escaped
    // in text and title
    let text = html_unescape(row.pagetext);

    let entry = new N.models.blogs.BlogEntry();

    entry._id        = new mongoose.Types.ObjectId(row.dateline);
    entry.hid        = row.blogid;
    entry.title      = html_unescape(row.title);
    entry.user       = user_id;
    entry.md         = text;
    entry.html       = '<p>' + _.escape(text) + '</p>';
    entry.ts         = new Date(row.dateline * 1000);
    entry.views      = row.views;
    entry.params_ref = params_id;

    let tag_source = '';

    if (row.categories) tag_source += row.categories.split(',').map(id => category_titles[id]).join(', ');
    if (row.taglist) tag_source += (tag_source ? ', ' : '') + html_unescape(row.taglist);

    if (tag_source.length) {
      entry.tag_source = tag_source;
    }

    let tag_hids = [];

    if (row.categories) {
      for (let id of row.categories.split(',')) {
        tag_hids.push(await create_tag(category_titles[id], user, row.dateline, id));
      }
    }

    if (row.taglist) {
      for (let title of row.taglist.split(',')) {
        tag_hids.push(await create_tag(title, user, row.dateline, null));
      }
    }

    if (tag_hids.length) {
      entry.tag_hids = _.uniq(tag_hids);
    }

    let ip = row.ipaddress;

    if (ip) {
      /* eslint-disable no-bitwise */
      entry.ip = `${ip >> 24 & 0xFF}.${ip >> 16 & 0xFF}.${ip >> 8 & 0xFF}.${ip & 0xFF}`;
    }

    /* eslint-disable no-bitwise */
    if (row.state !== 'visible' || (row.options & blog_private) || row.pending) {
      //  - drafts (state=draft)
      //  - deleted blogs (state=deleted)
      //  - private blogs (options & 8)
      //  - blogs with pending=true
      entry.st = N.models.blogs.BlogEntry.statuses.DELETED;
    } else {
      entry.st = N.models.blogs.BlogEntry.statuses.VISIBLE;
    }

    if (user && user.hb) {
      entry.ste = entry.st;
      entry.st  = N.models.blogs.BlogEntry.statuses.HB;
    }

    // "mapping" here is only needed to store original bbcode text content
    await new N.models.vbconvert.BlogTextMapping({
      blogid:     row.blogid,
      blogtextid: row.blogtextid,
      is_comment: false,
      mongo:      entry._id,
      text
    }).save();

    await entry.save();
  }

  // reset counter
  let { maxid } = (await conn.query('SELECT MAX(blogid) AS maxid FROM blog'))[0][0];

  await N.models.core.Increment.update(
    { key: 'blog_entry' },
    { $set: { value: maxid } },
    { upsert: true }
  );

  bar.terminate();
  get_user_by_hid.clear();
  get_default_usergroup.clear();
  get_parser_param_id.clear();
  conn.release();
  N.logger.info('Blog entry import finished');
};
