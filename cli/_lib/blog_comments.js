// Import blog comments
//

'use strict';


const _             = require('lodash');
const Promise       = require('bluebird');
const mongoose      = require('mongoose');
const memoize       = require('promise-memoize');
const progress      = require('./utils').progress;


module.exports = async function (N) {
  let conn = await N.vbconvert.getConnection();

  let rows = (await conn.query(`
    SELECT count(*) AS count
    FROM blog JOIN blog_text USING(blogid)
    WHERE blog_text.blogtextid != blog.firstblogtextid
  `))[0];

  let bar = progress(' blog comments :current/:total :percent', rows[0].count);

  let blogids = (await conn.query('SELECT blogid FROM blog ORDER BY blogid ASC'))[0];

  const get_user_by_hid = memoize(function (hid) {
    return N.models.users.User.findOne({ hid }).lean(true);
  });

  const get_default_usergroup = memoize(function () {
    return N.models.users.UserGroup.findOne({ short_name: 'members' }).lean(true);
  });

  const get_parser_param_id = memoize(function (usergroup_ids, allowsmilie) {
    return N.settings.getByCategory(
      'blog_comments_markup',
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

  await Promise.map(blogids, async function (blog) {
    let entry = await N.models.blogs.BlogEntry.findOne({ hid: blog.blogid }).lean(true);

    // We skipped import of deleted blog entries. Comments should be skipped too.
    if (!entry) return;

    let rows = (await conn.query(`
      SELECT blog_text.blogid,blog_text.blogtextid,blog_text.userid,
             blog_text.dateline,blog_text.pagetext,blog_text.state,
             blog_text.allowsmilie,blog_text.ipaddress
      FROM blog JOIN blog_text USING(blogid)
      WHERE blogid = ?
        AND blog_text.blogtextid != blog.firstblogtextid
      ORDER BY blogtextid ASC
    `, [ blog.blogid ]))[0];

    let count = 0;
    let comment_bulk = N.models.blogs.BlogComment.collection.initializeOrderedBulkOp();
    let map_bulk     = N.models.vbconvert.BlogTextMapping.collection.initializeOrderedBulkOp();

    for (let row of rows) {
      bar.tick();

      // don't import deleted comments, state=deleted or state=moderation
      if (row.state !== 'visible') continue;

      let existing_mapping = await N.models.vbconvert.BlogTextMapping.findOne()
                                       .where('blogtextid').equals(row.blogtextid)
                                       .lean(true);

      // comment with this id is already imported
      if (existing_mapping) continue;

      let user = await get_user_by_hid(row.userid);

      if (user && !user.active) {
        user.active = true;

        await N.models.users.User.updateOne({ _id: user._id }, { $set: { active: true } });
      }

      let params_id = await get_parser_param_id(
        (user && user.usergroups) ? user.usergroups : [ (await get_default_usergroup())._id ],
        row.allowsmilie
      );

      count++;

      let comment = {};

      comment._id          = new mongoose.Types.ObjectId(row.dateline);
      comment.entry        = entry._id;
      comment.entry_exists = entry.st === N.models.blogs.BlogEntry.statuses.VISIBLE ||
                             entry.st === N.models.blogs.BlogEntry.statuses.HB;
      comment.hid          = entry.last_comment_counter + count;
      comment.user         = user ? user._id : new mongoose.Types.ObjectId('000000000000000000000000');
      comment.md           = row.pagetext;
      comment.html         = '<p>' + _.escape(row.pagetext) + '</p>';
      comment.ts           = new Date(row.dateline * 1000);
      comment.params_ref   = params_id;
      comment.attach       = []; // an array in DB is required by parser
      comment.path         = []; // make all comments root (no reply-to data available in mysql)

      let ip = row.ipaddress;

      if (ip) {
        /* eslint-disable no-bitwise */
        comment.ip = `${ip >> 24 & 0xFF}.${ip >> 16 & 0xFF}.${ip >> 8 & 0xFF}.${ip & 0xFF}`;
      }

      comment.st = N.models.blogs.BlogComment.statuses.VISIBLE;

      if (user && user.hb) {
        comment.ste = comment.st;
        comment.st  = N.models.blogs.BlogComment.statuses.HB;
      }

      comment_bulk.insert(comment);
      map_bulk.insert({
        blogid:     row.blogid,
        blogtextid: row.blogtextid,
        is_comment: true,
        mongo:      comment._id,
        text:       row.pagetext
      });
    }

    if (count > 0) {
      await N.models.blogs.BlogEntry.updateOne(
        { _id: entry._id },
        { $set: {
          last_comment_counter: count
        } }
      );
      await comment_bulk.execute();
      await map_bulk.execute();
      await N.models.blogs.BlogEntry.updateCache(entry._id);
    }
  }, { concurrency: 100 });

  bar.terminate();
  get_user_by_hid.clear();
  get_default_usergroup.clear();
  get_parser_param_id.clear();
  conn.release();
  N.logger.info('Blog comment import finished');
};
