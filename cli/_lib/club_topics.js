// Convert topics and posts in clubs
//

'use strict';


const _             = require('lodash');
const Promise       = require('bluebird');
const mongoose      = require('mongoose');
const html_unescape = require('nodeca.vbconvert/lib/html_unescape_entities');
const progress      = require('./utils').progress;


module.exports = async function (N) {
  let conn, users, clubs;

  let default_usergroup_id = (
    await N.models.users.UserGroup.findOne()
              .where('short_name').equals('members')
              .select('_id')
              .lean(true)
  )._id;

  let parser_param_id_cache = {};


  // Import a single topic by its id
  //
  async function import_topic(discussionid) {
    let discussion, posts, topic;

    //
    // Fetch this thread from MySQL
    //
    discussion = (await conn.query(`
      SELECT discussion.discussionid,groupid,title,dateline,state
      FROM discussion JOIN groupmessage
        ON discussion.firstpostid = groupmessage.gmid
      WHERE discussion.discussionid = ?
    `, [ discussionid ]))[0][0];


    //
    // Create a dummy { _id, hid } object in the mongodb, check if topic
    // can be imported.
    //
    if (!clubs[discussion.groupid]) return;

    topic = {
      _id:         new mongoose.Types.ObjectId(discussion.dateline),
      hid:         discussion.discussionid,
      club:        clubs[discussion.groupid]._id,
      title:       html_unescape(discussion.title),
      views_count: 0,
      version:     0
    };

    let old_topic = await N.models.clubs.Topic.findOneAndUpdate(
                      { hid: discussion.discussionid },
                      { $setOnInsert: topic },
                      { 'new': false, upsert: true }
                    ).lean(true);

    if (old_topic) {
      // topic had been imported fully last time
      if (old_topic.cache) return;

      // reuse old topic if it exists, but haven't been fully imported
      topic._id = old_topic._id;

      // topic hadn't been imported last time, remove all posts and try again
      await N.models.clubs.Post.find({ topic: old_topic._id }).remove();
      await N.models.vbconvert.ClubPostMapping.find({ topic_id: old_topic._id }).remove();
    }

    await new N.models.vbconvert.ClubTopicTitle({
      mysql: discussion.discussionid,
      title: discussion.title
    }).save();


    //
    // Fetch posts from this thread from MySQL
    //
    posts = (await conn.query(`
      SELECT discussionid,gmid,pagetext,dateline,ipaddress,postuserid,postusername,state,allowsmilie
      FROM groupmessage
      WHERE discussionid = ?
      ORDER BY gmid ASC
    `, [ discussion.discussionid ]))[0];

    // empty topic, e.g. http://forum.rcdesign.ru/f90/thread121809.html
    if (posts.length === 0) {
      await N.models.clubs.Topic.find({ _id: topic._id }).remove();
      return;
    }


    //
    // Bulk-store posts into mongodb
    //
    {
      let post_bulk = N.models.clubs.Post.collection.initializeOrderedBulkOp();
      let map_bulk  = N.models.vbconvert.ClubPostMapping.collection.initializeOrderedBulkOp();
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
        let user = users[post.postuserid] || {};

        // mark poster as an active user
        if (!user.active) {
          user.active = true;

          await N.models.users.User.update({ _id: user._id }, { $set: { active: true } });
        }

        hid++;

        let allowsmilie = !!post.allowsmilie;
        let key = (user.usergroups || []).join(',') + ';' + String(post.allowsmilie);

        if (!parser_param_id_cache[key]) {
          let usergroup_ids = user.usergroups || [ default_usergroup_id ];
          let params = await N.settings.getByCategory(
            'clubs_posts_markup',
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

        if (post.state === 'visible' || hid === 1) {
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
          club:       topic.club,
          hid,
          ts,
          md:         post.pagetext,
          html:       '<p>' + _.escape(post.pagetext) + '</p>',
          params_ref: params_id,
          attach:     [] // an array in DB is required by parser
        };

        let ip = post.ipaddress;

        if (ip) {
          /* eslint-disable no-bitwise */
          new_post.ip = `${ip >> 24 & 0xFF}.${ip >> 16 & 0xFF}.${ip >> 8 & 0xFF}.${ip & 0xFF}`;
        }

        if (user._id) {
          new_post.user = user._id;
        } else {
          new_post.legacy_nick = post.postusername;
        }

        new_post.votes = 0;
        new_post.votes_hb = 0;

        if (user.hb) {
          new_post.st  = N.models.clubs.Post.statuses.HB;
          new_post.ste = N.models.clubs.Post.statuses.VISIBLE;
        } else {
          new_post.st = N.models.clubs.Post.statuses.VISIBLE;
        }

        if (post.state !== 'visible') {
          new_post.prev_st = _.omitBy({
            st:  new_post.st,
            ste: new_post.ste
          }, _.isUndefined);

          new_post.st = N.models.clubs.Post.statuses.DELETED;
          delete new_post.ste;
        }

        post_bulk.insert(new_post);
        map_bulk.insert({
          mysql:    post.gmid,
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
    topic.st = N.models.clubs.Topic.statuses.OPEN;

    let user = users[posts[0].postuserid] || {};

    if (user.hb) {
      topic.ste = topic.st;
      topic.st  = N.models.clubs.Topic.statuses.HB;
    }

    if (discussion.state !== 'visible') {
      topic.prev_st = _.omitBy({
        st:  topic.st,
        ste: topic.ste
      }, _.isUndefined);

      topic.st = N.models.clubs.Topic.statuses.DELETED;
      delete topic.ste;
    }

    await N.models.clubs.Topic.update(
      { hid: discussion.discussionid },
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
  // Fetch all clubs
  //
  clubs = {};

  (await N.models.clubs.Club.find().lean(true)).forEach(club => {
    clubs[club.hid] = club;
  });

  //
  // Import topics and posts
  //
  {
    let rows = (await conn.query('SELECT discussionid FROM discussion ORDER BY discussionid ASC'))[0];

    let bar = progress(' club topics :current/:total :percent', rows.length);

    await Promise.map(rows, function (row) {
      return import_topic(row.discussionid).then(() => {
        bar.tick();
      });
    }, { concurrency: 100 });

    bar.terminate();

    await N.models.core.Increment.update(
      { key: 'clubs_topic' },
      { $set: { value: rows[rows.length - 1].discussionid } },
      { upsert: true }
    );
  }


  //
  // Finalize
  //
  conn.release();
  N.logger.info('Club topic import finished');
};
