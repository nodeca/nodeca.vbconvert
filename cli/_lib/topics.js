// Convert topics and posts
//

'use strict';


const _             = require('lodash');
const Promise       = require('bluebird');
const co            = require('bluebird-co').co;
const mongoose      = require('mongoose');
const memoize       = require('promise-memoize');
const progress      = require('./utils').progress;
const html_unescape = require('./utils').html_unescape;
const POST          = 1; // content type for posts


module.exports = co.wrap(function* (N) {
  var conn, users, sections;


  const get_default_usergroup = memoize(function () {
    return N.models.users.UserGroup.findOne({ short_name: 'members' }).lean(true);
  });


  const get_parser_param_id = memoize(function (usergroup_ids, allowsmilie) {
    return N.settings.getByCategory(
      'forum_posts_markup',
      { usergroup_ids },
      { alias: true }
    ).then(params => {
      if (!allowsmilie) {
        params.emoji = false;
      }

      return N.models.core.MessageParams.setParams(params);
    });
  });


  // Import a single topic by its id
  //
  const import_topic = co.wrap(function* (threadid) {
    var thread, posts, topic;

    //
    // Fetch this thread from SQL
    //
    thread = (yield conn.query(`
      SELECT threadid,forumid,title,views,dateline,visible,open,sticky
      FROM thread WHERE threadid = ?
      ORDER BY threadid ASC
    `, [ threadid ]))[0];


    //
    // Create a dummy { _id, hid } object in the mongodb, check if topic
    // can be imported.
    //
    if (!sections[thread.forumid]) return;

    topic = {
      _id:         new mongoose.Types.ObjectId(thread.dateline),
      hid:         thread.threadid,
      section:     sections[thread.forumid]._id,
      title:       html_unescape(thread.title),
      views_count: thread.views,
      version:     0
    };

    let old_topic = yield N.models.forum.Topic.findOneAndUpdate(
                      { hid: thread.threadid },
                      { $setOnInsert: topic },
                      { 'new': false, upsert: true }
                    ).lean(true);

    if (old_topic) {
      // topic had been imported fully last time
      if (old_topic.cache) return;

      // reuse old topic if it exists, but haven't been fully imported
      topic._id = old_topic._id;

      // topic hadn't been imported last time, remove all posts and try again
      yield N.models.forum.Post.find({ topic: old_topic._id }).remove();
      yield N.models.vbconvert.PostMapping.find({ topic_id: old_topic._id }).remove();
    }


    //
    // Fetch posts from this thread from SQL
    //
    posts = yield conn.query(`
      SELECT threadid,postid,parentid,pagetext,dateline,ipaddress,userid,username,visible,allowsmilie,
             GROUP_CONCAT(vote) AS votes,GROUP_CONCAT(fromuserid) AS casters
      FROM post
      LEFT JOIN votes ON post.postid = votes.targetid AND votes.contenttypeid = ?
      WHERE threadid = ?
      GROUP BY postid
      ORDER BY postid ASC
    `, [ POST, thread.threadid ]);

    // empty topic, e.g. http://forum.rcdesign.ru/f90/thread121809.html
    if (posts.length === 0) {
      yield N.models.forum.Topic.find({ _id: topic._id }).remove();
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

      let usergroup_params = {};

      for (let post of posts) {
        let id   = new mongoose.Types.ObjectId(post.dateline);
        let ts   = new Date(post.dateline * 1000);
        let user = users[post.userid] || {};

        hid++;

        let key = (user.usergroups || []).join(',') + ';' + String(!!post.allowsmilie);

        // cache parser params locally, this prevents stack overflow
        // when yielding synchronous functions into bluebird-co
        if (!usergroup_params[key]) {
          usergroup_params[key] = yield get_parser_param_id(
            user.usergroups || (yield get_default_usergroup()),
            post.allowsmilie
          );
        }

        let params_id = usergroup_params[key];

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
          _id:        id,
          topic:      topic._id,
          hid,
          ts,
          md:         post.pagetext,
          html:       '<p>' + _.escape(post.pagetext) + '</p>',
          ip:         post.ipaddress,
          params_ref: params_id,
          attach:     [] // an array in DB is required by parser
        };

        if (user._id) {
          new_post.user = user._id;
        } else {
          new_post.legacy_nick = post.username;
        }

        new_post.votes = 0;
        new_post.votes_hb = 0;

        /* eslint-disable no-loop-func */
        _.zip((post.casters || '').split(','), (post.votes || '').split(',')).forEach(function (arr) {
          if (arr[0] && arr[1]) {
            if (users[arr[0]]) {
              new_post.votes_hb += Number(arr[1]);

              if (!users[arr[0]].hb) {
                new_post.votes += Number(arr[1]);
              }
            }
          }
        });

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

      yield post_bulk.execute();
      yield map_bulk.execute();
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

    if (users[posts[0].userid] && users[posts[0].userid].hb) {
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

    yield N.models.forum.Topic.update(
      { hid: thread.threadid },
      topic
    );
  });

  //
  // Establish MySQL connection
  //
  conn = yield N.vbconvert.getConnection();

  //
  // Fetch all users
  //
  users = {};

  (yield N.models.users.User.find().lean(true)).forEach(user => {
    users[user.hid] = user;
  });

  //
  // Fetch all sections
  //
  sections = {};

  (yield N.models.forum.Section.find().lean(true)).forEach(section => {
    sections[section.hid] = section;
  });

  //
  // Import topics and posts
  //
  {
    let rows = yield conn.query('SELECT threadid FROM thread ORDER BY threadid ASC');

    let bar = progress(' topics :current/:total [:bar] :percent', rows.length);

    yield Promise.map(rows, function (row) {
      return import_topic(row.threadid).then(() => {
        bar.tick();
      });
    }, { concurrency: 100 });

    bar.terminate();

    yield N.models.core.Increment.update(
      { key: 'topic' },
      { $set: { value: rows[rows.length - 1].threadid } },
      { upsert: true }
    );
  }

  //
  // Link posts that reply to a different topic
  //
  {
    let rows = yield conn.query(`
      SELECT post.postid,post.parentid
      FROM post
      JOIN post AS parent
           ON (post.parentid = parent.postid AND post.threadid != parent.threadid)
    `);

    yield Promise.map(rows, co.wrap(function* (row) {
      let post_mapping = yield N.models.vbconvert.PostMapping.findOne()
                                   .where('mysql', row.postid)
                                   .lean(true);

      let parent_post_mapping = yield N.models.vbconvert.PostMapping.findOne()
                                          .where('mysql', row.parentid)
                                          .lean(true);

      let post = yield N.models.forum.Post.findOne()
                           .where('topic', parent_post_mapping.topic_id)
                           .where('hid', parent_post_mapping.post_hid)
                           .lean(true);

      let topic = yield N.models.forum.Topic.findById(post.topic).lean(true);

      let section = yield N.models.forum.Section.findById(topic.section).lean(true);

      yield N.models.forum.Post.update({
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
    }), { concurrency: 100 });
  }


  //
  // Finalize
  //
  get_default_usergroup.clear();
  get_parser_param_id.clear();
  conn.release();
  N.logger.info('Topic import finished');
});
