// Convert topics and posts
//

'use strict';


var _        = require('lodash');
var async    = require('async');
var mongoose = require('mongoose');
var progress = require('./_progressbar');


module.exports = function (N, callback) {
  var users, sections, conn;

  // Get a { hid: { _id, hb } } mapping for all registered users
  //
  function get_users(callback) {
    N.models.users.User.find()
        .select('hid _id hb')
        .lean(true)
        .exec(function (err, userlist) {

      if (err) {
        callback(err);
        return;
      }

      users = {};

      userlist.forEach(function (user) {
        users[user.hid] = user;
      });

      callback();
    });
  }


  // Get a { hid: { _id } } mapping for all sections
  //
  function get_sections(callback) {
    N.models.forum.Section.find()
        .select('hid _id')
        .lean(true)
        .exec(function (err, sectionlist) {

      if (err) {
        callback(err);
        return;
      }

      sections = {};

      sectionlist.forEach(function (section) {
        sections[section.hid] = section;
      });

      callback(null, sections);
    });
  }


  // Allocate SQL connection from the pool
  //
  function get_connection(callback) {
    N.vbconvert.getConnection(function (err, connection) {
      if (err) {
        callback(err);
        return;
      }

      conn = connection;
      callback();
    });
  }


  // Import a single topic by its id
  //
  function import_topic(threadid, callback) {
    var thread, posts, topic;

    // Fetch this thread from SQL
    //
    function fetch_thread(callback) {
      conn.query('SELECT threadid,forumid,title,views,dateline,visible,open,sticky ' +
          'FROM thread WHERE threadid = ? ORDER BY threadid ASC',
          [ threadid ],
          function (err, thread_data) {

        if (err) {
          callback(err);
          return;
        }

        thread = thread_data[0];

        callback();
      });
    }


    // Create a dummy { _id, hid } object in the mongodb, check if topic
    // can be imported.
    //
    // If topic is already imported or can't be imported, return error
    // with NOOP code that's ignored later on.
    //
    function create_topic_stub(callback) {
      if (!sections[thread.forumid]) {
        var err = new Error('this section is ignored');
        err.code = 'NOOP';
        callback(err);
        return;
      }

      topic = {
        _id:         new mongoose.Types.ObjectId(thread.dateline),
        hid:         thread.threadid,
        section:     sections[thread.forumid]._id,
        title:       thread.title,
        views_count: thread.views
      };

      N.models.forum.Topic.findOneAndUpdate(
        { hid: thread.threadid },
        { $setOnInsert: topic },
        { 'new': false, upsert: true }
      ).lean(true).exec(function (err, old_topic) {
          if (err) {
            callback(err);
            return;
          }

          if (!old_topic) {
            // successfully created a dummy topic entry
            callback();
            return;
          }

          if (old_topic.cache) {
            // topic had been imported fully last time
            err = new Error('topic already imported');
            err.code = 'NOOP';
            callback(err);
            return;
          }

          // reuse old topic if it exists, but haven't been fully imported
          topic._id = old_topic._id;

          // topic hadn't been imported last time, remove all posts and try again
          N.models.forum.Post.find({ topic: old_topic._id })
                             .remove()
                             .exec(callback);
        }
      );
    }


    // Fetch posts from this thread from SQL
    //
    function fetch_posts(callback) {
      conn.query('SELECT pagetext,dateline,ipaddress,userid,visible ' +
          'FROM post WHERE threadid = ? ORDER BY postid ASC',
          [ thread.threadid ],
          function (err, rows) {

        if (err) {
          callback(err);
          return;
        }

        if (rows.length === 0) {
          err = new Error('no posts in this topic');
          err.code = 'NOOP';
          callback(err);
          return;
        }

        posts = rows;

        callback();
      });
    }


    // Bulk-store posts into mongodb
    //
    function import_posts(callback) {
      var bulk = N.models.forum.Post.collection.initializeOrderedBulkOp();
      var cache = topic.cache = {
        post_count: 0
      };
      var cache_hb = topic.cache_hb = {
        post_count: 0
      };

      posts.forEach(function (post, i) {
        var id   = new mongoose.Types.ObjectId(post.dateline);
        var ts   = new Date(post.dateline * 1000);
        var user = users[post.userid] || {};

        if (i === 0) {
          cache_hb.first_post = id;
          cache_hb.first_ts   = ts;
          cache_hb.first_user = user._id;

          cache.first_post = id;
          cache.first_ts   = ts;
          cache.first_user = user._id;
        }

        cache_hb.post_count++;
        cache_hb.last_post = id;
        cache_hb.last_ts   = ts;
        cache_hb.last_user = user._id;

        if (!user.hb || i === 0) {
          cache.post_count++;
          cache.last_post = id;
          cache.last_ts   = ts;
          cache.last_user = user._id;
        }

        var new_post = {
          _id:    id,
          topic:  topic._id,
          hid:    i + 1,
          ts:     ts,
          html:   post.pagetext,
          ip:     post.ipaddress,
          user:   user._id
        };

        if (user.hb) {
          new_post.st  = N.models.forum.Post.statuses.HB;
          new_post.ste = N.models.forum.Post.statuses.VISIBLE;
        } else {
          new_post.st = N.models.forum.Post.statuses.VISIBLE;
        }

        if (post.visible !== 1) {
          new_post.prev_st = _.omit({
            st:  new_post.st,
            ste: new_post.ste
          }, _.isUndefined);

          new_post.st = N.models.forum.Post.statuses.DELETED;
          delete new_post.ste;
        }

        bulk.insert(new_post);
      });

      bulk.execute(callback);
    }


    // Update created topic
    //
    function update_topic(callback) {
      topic.last_post_hid = posts.length - 1;

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
        topic.prev_st = _.omit({
          st:  topic.st,
          ste: topic.ste
        }, _.isUndefined);

        topic.st = N.models.forum.Topic.statuses.DELETED;
        delete topic.ste;
      }

      N.models.forum.Topic.update(
        { hid: thread.threadid },
        topic,
        callback
      );
    }


    async.series([
      fetch_thread,
      create_topic_stub,
      fetch_posts,
      import_posts,
      update_topic
    ], function (err) {
      callback(err && err.code !== 'NOOP' ? err : null);
    });
  }


  // Import topics and posts
  //
  function import_all_topics(callback) {
    conn.query('SELECT threadid FROM thread ORDER BY threadid ASC', function (err, rows) {
      if (err) {
        callback(err);
        return;
      }

      var bar = progress(' filling topics :current/:total [:bar] :percent', rows.length);

      async.eachLimit(rows, 10, function (row, callback) {
        bar.tick();
        import_topic(row.threadid, callback);
      }, function (err) {
        if (err) {
          callback(err);
          return;
        }

        bar.terminate();

        N.models.core.Increment.update(
          { key: 'topic' },
          { $set: { value: rows[rows.length - 1].threadid } },
          { upsert: true },
          callback
        );
      });
    });
  }


  async.series([
    get_users,
    get_sections,
    get_connection,
    import_all_topics
  ], function (err) {
    if (err) {
      callback(err);
      return;
    }

    if (conn) {
      conn.release();
    }

    N.logger.info('Topic import finished');
    callback();
  });
};
