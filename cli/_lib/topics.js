// Convert topics and posts
//

'use strict';


const _             = require('lodash');
const Promise       = require('bluebird');
const mongoose      = require('mongoose');
const html_unescape = require('nodeca.vbconvert/lib/html_unescape_entities');
const progress      = require('./utils').progress;

const prefixes = {
  forsale: 'Продам: ',
  guveup:  'Отдам: ',
  wanted:  'Куплю: '
};


module.exports = async function (N) {
  let conn, users, sections;

  let empty_sections = _.zipObject(N.config.vbconvert.empty_sections || []);

  let default_usergroup_id = (
    await N.models.users.UserGroup.findOne()
              .where('short_name').equals('members')
              .select('_id')
              .lean(true)
  )._id;

  let parser_param_id_cache = {};


  // Import a single topic by its id
  //
  async function import_topic(threadid) {
    let thread, posts, topic;

    //
    // Fetch this thread from SQL
    //
    thread = (await conn.query(`
      SELECT threadid,forumid,title,prefixid,views,dateline,visible,open,sticky
      FROM thread WHERE threadid = ?
    `, [ threadid ]))[0][0];


    //
    // Create a dummy { _id, hid } object in the mongodb, check if topic
    // can be imported.
    //
    if (!sections[thread.forumid]) return;

    // don't import topics in specified sections
    if (empty_sections.hasOwnProperty(thread.forumid)) return;

    let prefix = '';

    if (thread.prefixid && prefixes[thread.prefixid]) {
      prefix = prefixes[thread.prefixid];
    }

    topic = {
      _id:         new mongoose.Types.ObjectId(thread.dateline),
      hid:         thread.threadid,
      section:     sections[thread.forumid]._id,
      title:       prefix + html_unescape(thread.title),
      views_count: thread.views,
      version:     0
    };

    let old_topic = await N.models.forum.Topic.findOneAndUpdate(
                      { hid: thread.threadid },
                      { $setOnInsert: topic },
                      { new: false, upsert: true }
                    ).lean(true);

    if (old_topic) {
      // topic had been imported fully last time
      if (old_topic.cache) return;

      // reuse old topic if it exists, but haven't been fully imported
      topic._id = old_topic._id;

      // topic hadn't been imported last time, remove all posts and try again
      await N.models.forum.Post.deleteMany({ topic: old_topic._id });
      await N.models.vbconvert.PostMapping.deleteMany({ topic_id: old_topic._id });
    }

    /* eslint-disable no-undefined */
    await new N.models.vbconvert.TopicTitle({
      mysql:  thread.threadid,
      title:  thread.title,
      prefix: thread.prefixid || undefined
    }).save();


    //
    // Fetch posts from this thread from SQL
    //
    posts = (await conn.query(`
      SELECT threadid,postid,parentid,pagetext,dateline,ipaddress,userid,username,visible,allowsmilie
      FROM post
      WHERE threadid = ?
      ORDER BY postid ASC
    `, [ thread.threadid ]))[0];

    // empty topic, e.g. http://forum.rcdesign.ru/f90/thread121809.html
    if (posts.length === 0) {
      await N.models.forum.Topic.deleteOne({ _id: topic._id });
      return;
    }


    //
    // Bulk-store posts into mongodb
    //
    {
      let posts_by_id = {};
      let post_bulk = N.models.forum.Post.collection.initializeOrderedBulkOp();
      let map_bulk  = N.models.vbconvert.PostMapping.collection.initializeOrderedBulkOp();
      let cache = topic.cache = {
        post_count: 0
      };
      let cache_hb = topic.cache_hb = {
        post_count: 0
      };
      let hid = 0;

      for (let post of posts) {
        let id   = new mongoose.Types.ObjectId(post.dateline);
        let ts   = new Date(post.dateline * 1000);
        let user = users[post.userid] || {};

        // change author of all messages in abuse report section to a bot
        if (thread.forumid === N.config.vbconvert.abuse_report_section) {
          user = users[N.config.bots.default_bot_hid] || {};
        }

        // mark poster as an active user
        if (!user.active) {
          user.active = true;

          await N.models.users.User.updateOne({ _id: user._id }, { $set: { active: true } });
        }

        hid++;

        let allowsmilie = !!post.allowsmilie;
        let key = (user.usergroups || []).join(',') + ';' + String(post.allowsmilie);

        if (!parser_param_id_cache[key]) {
          let usergroup_ids = user.usergroups || [ default_usergroup_id ];
          let params = await N.settings.getByCategory(
            'forum_posts_markup',
            { usergroup_ids },
            { alias: true }
          );

          if (!allowsmilie) params.emoji = false;

          parser_param_id_cache[key] = await N.models.core.MessageParams.setParams(params);
        }

        let params_id = parser_param_id_cache[key];

        if (hid === 1) {
          cache_hb.first_post = id;
          cache_hb.first_ts   = ts;
          cache_hb.first_user = user._id;

          cache.first_post = id;
          cache.first_ts   = ts;
          cache.first_user = user._id;
        }

        if (post.visible === 1 || hid === 1) {
          cache_hb.post_count++;
          cache_hb.last_post     = id;
          cache_hb.last_post_hid = hid;
          cache_hb.last_ts       = ts;
          cache_hb.last_user     = user._id;

          if (!user.hb || hid === 1) {
            cache.post_count++;
            cache.last_post     = id;
            cache.last_post_hid = hid;
            cache.last_ts       = ts;
            cache.last_user     = user._id;
          }
        }

        let new_post = {
          _id:          id,
          topic:        topic._id,
          topic_exists: !!thread.visible,
          section:      topic.section,
          hid,
          ts,
          md:           post.pagetext,
          html:         '<p>' + _.escape(post.pagetext) + '</p>',
          ip:           post.ipaddress,
          params_ref:   params_id,
          attach:       [] // an array in DB is required by parser
        };

        if (user._id) {
          new_post.user = user._id;
        } else {
          new_post.legacy_nick = post.username;
        }

        new_post.votes = 0;
        new_post.votes_hb = 0;

        if (user.hb) {
          new_post.st  = N.models.forum.Post.statuses.HB;
          new_post.ste = N.models.forum.Post.statuses.VISIBLE;
        } else {
          new_post.st = N.models.forum.Post.statuses.VISIBLE;
        }

        if (post.visible !== 1) {
          new_post.prev_st = _.omitBy({
            st:  new_post.st,
            ste: new_post.ste
          }, _.isUndefined);

          new_post.st = N.models.forum.Post.statuses.DELETED;
          delete new_post.ste;
        }

        // process replies if they are in the same topic
        if (post.parentid && posts_by_id[post.parentid]) {
          // ignore replies to the first post because most of them are
          // (that's the default for "reply in thread" button)
          if (posts_by_id[post.parentid].hid !== 1) {
            new_post.to      = posts_by_id[post.parentid]._id;
            new_post.to_user = posts_by_id[post.parentid].user;
            new_post.to_phid = posts_by_id[post.parentid].hid;
          }
        }

        posts_by_id[post.postid] = new_post;

        post_bulk.insert(new_post);
        map_bulk.insert({
          mysql:    post.postid,
          topic_id: topic._id,
          post_id:  new_post._id,
          post_hid: hid,
          text:     post.pagetext
        });
      }

      await post_bulk.execute();
      await map_bulk.execute();
    }


    //
    // Update created topic
    //

    // each fetched post is assigned a consecutive hid starting with 1,
    // so the last hid will be equal to the number of posts
    topic.last_post_counter = posts.length;

    topic.st = thread.open ?
               N.models.forum.Topic.statuses.OPEN :
               N.models.forum.Topic.statuses.CLOSED;

    let user = users[posts[0].userid] || {};

    // change author of all messages in abuse report section to a bot
    if (thread.forumid === N.config.vbconvert.abuse_report_section) {
      user = users[N.config.bots.default_bot_hid] || {};
    }

    if (user.hb) {
      topic.ste = topic.st;
      topic.st  = N.models.forum.Topic.statuses.HB;
    } else if (thread.sticky) {
      topic.ste = topic.st;
      topic.st  = N.models.forum.Topic.statuses.PINNED;
    }

    if (thread.visible !== 1) {
      topic.prev_st = _.omitBy({
        st:  topic.st,
        ste: topic.ste
      }, _.isUndefined);

      topic.st = N.models.forum.Topic.statuses.DELETED;
      delete topic.ste;
    }

    await N.models.forum.Topic.updateOne(
      { hid: thread.threadid },
      topic
    );
  }

  //
  // Establish MySQL connection
  //
  conn = await N.vbconvert.getConnection();

  //
  // Fetch all users
  //
  users = {};

  (await N.models.users.User.find().lean(true)).forEach(user => {
    users[user.hid] = user;
  });

  //
  // Fetch all sections
  //
  sections = {};

  (await N.models.forum.Section.find().lean(true)).forEach(section => {
    sections[section.hid] = section;
  });

  //
  // Import topics and posts
  //
  {
    let rows = (await conn.query('SELECT threadid FROM thread ORDER BY threadid ASC'))[0];

    let bar = progress(' topics :current/:total :percent', rows.length);

    await Promise.map(rows, function (row) {
      return import_topic(row.threadid).then(() => {
        bar.tick();
      });
    }, { concurrency: 100 });

    bar.terminate();

    await N.models.core.Increment.updateOne(
      { key: 'topic' },
      { $set: { value: rows[rows.length - 1].threadid } },
      { upsert: true }
    );
  }

  //
  // Link posts that reply to a different topic
  //
  // Could happen if a single topic is split into two different topics,
  // so post from one topic would reply to another.
  //
  // Commented out because it never happens currently.
  //
  /*{
    let rows = (await conn.query(`
      SELECT post.postid,post.parentid
      FROM post
      JOIN post AS parent
           ON (post.parentid = parent.postid AND post.threadid != parent.threadid)
    `))[0];

    await Promise.map(rows, async function (row) {
      let post_mapping = await N.models.vbconvert.PostMapping.findOne()
                                   .where('mysql', row.postid)
                                   .lean(true);

      let parent_post_mapping = await N.models.vbconvert.PostMapping.findOne()
                                          .where('mysql', row.parentid)
                                          .lean(true);

      let post = await N.models.forum.Post.findOne()
                           .where('topic', parent_post_mapping.topic_id)
                           .where('hid', parent_post_mapping.post_hid)
                           .lean(true);

      let topic = await N.models.forum.Topic.findById(post.topic).lean(true);

      let section = await N.models.forum.Section.findById(topic.section).lean(true);

      await N.models.forum.Post.updateOne({
        topic: post_mapping.topic_id,
        hid: post_mapping.post_hid
      }, {
        $set: {
          to: post._id,
          to_user: post.user,
          to_phid: post.hid,
          to_thid: topic.hid,
          to_fhid: section.hid
        }
      });
    }, { concurrency: 100 });
  }*/


  //
  // Finalize
  //
  conn.release();
  N.logger.info('Topic import finished');
};
