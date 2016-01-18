// Convert topics and posts
//

'use strict';


var _        = require('lodash');
var async    = require('async');
var memoizee = require('memoizee');
var mongoose = require('mongoose');
var progress = require('./progressbar');
var POST     = 1; // content type for posts

var html_entities = {
  '&amp;':  '&',
  '&quot;': '"',
  '&gt;':   '>',
  '&lt;':   '<'
};


// Replace html entities like "&quot;" with the corresponding characters
//
function html_unescape(text) {
  return text.replace(/&(?:quot|amp|lt|gt|#(\d{1,6}));/g, function (entity, code) {
    return html_entities[entity] || String.fromCharCode(+code);
  });
}


module.exports = function (N, callback) {
  /* eslint-disable max-nested-callbacks */
  var users, sections, conn;


  var get_default_usergroup = memoizee(function (callback) {
    N.models.users.UserGroup.findOne({ short_name: 'members' }).exec(callback);
  }, { async: true });


  var get_parser_param_id = memoizee(function (usergroup_ids, allowsmilie, callback) {
    N.settings.getByCategory(
        'forum_markup',
        { usergroup_ids: usergroup_ids },
        { alias: true },
        function (err, params) {

      if (err) {
        callback(err);
        return;
      }

      if (allowsmilie) {
        params.emoji = false;
      }

      N.models.core.MessageParams.setParams(params, callback);
    });
  }, { async: true, primitive: true });


  // Get parser options reference for a post
  //
  function get_post_parser_param_id(post, callback) {
    get_default_usergroup(function (err, default_usergroup) {
      if (err) {
        callback(err);
        return;
      }

      get_parser_param_id(
        users[post.userid] ? users[post.userid].usergroups : [ default_usergroup._id ],
        post.allowsmilie,
        callback
      );
    });
  }


  // Get a { hid: { _id, hb } } mapping for all registered users
  //
  function get_users(callback) {
    N.models.users.User.find()
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
        title:       html_unescape(thread.title),
        views_count: thread.views,
        version:     0
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
                             .exec(function (err) {
            if (err) {
              callback(err);
              return;
            }

            N.models.vbconvert.PostMapping.find({ topic_id: old_topic._id })
                                          .remove()
                                          .exec(callback);
          });
        }
      );
    }


    // Fetch posts from this thread from SQL
    //
    function fetch_posts(callback) {
      conn.query('SELECT threadid,postid,parentid,pagetext,dateline,ipaddress,userid,username,visible,allowsmilie,' +
          'GROUP_CONCAT(vote) AS votes,GROUP_CONCAT(fromuserid) AS casters ' +
          'FROM post LEFT JOIN votes ON post.postid = votes.targetid AND votes.contenttypeid = ? ' +
          'WHERE threadid = ? GROUP BY postid ORDER BY postid ASC',
          [ POST, thread.threadid ],
          function (err, rows) {

        if (err) {
          callback(err);
          return;
        }

        if (rows.length === 0) {
          // empty topic, e.g. http://forum.rcdesign.ru/f90/thread121809.html
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
      var posts_by_id = {};
      var post_bulk = N.models.forum.Post.collection.initializeOrderedBulkOp();
      var map_bulk  = N.models.vbconvert.PostMapping.collection.initializeOrderedBulkOp();
      var cache = topic.cache = {
        post_count: 0
      };
      var cache_hb = topic.cache_hb = {
        post_count: 0
      };
      var hid = 0;

      async.eachSeries(posts, function (post, callback) {
        var id   = new mongoose.Types.ObjectId(post.dateline);
        var ts   = new Date(post.dateline * 1000);
        var user = users[post.userid] || {};

        hid++;

        get_post_parser_param_id(post, function (err, params_id) {
          if (err) {
            callback(err);
            return;
          }

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
            cache_hb.last_post = id;
            cache_hb.last_ts   = ts;
            cache_hb.last_user = user._id;

            if (!user.hb || hid === 1) {
              cache.post_count++;
              cache.last_post = id;
              cache.last_ts   = ts;
              cache.last_user = user._id;
            }
          }

          var new_post = {
            _id:        id,
            topic:      topic._id,
            hid:        hid,
            ts:         ts,
            md:         post.pagetext,
            html:       post.pagetext,
            ip:         post.ipaddress,
            params_ref: params_id,
            attach:     []
          };

          if (user._id) {
            new_post.user = user._id;
          } else {
            new_post.legacy_nick = post.username;
          }

          new_post.votes = 0;
          new_post.votes_hb = 0;

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
            mysql_id: post.postid,
            topic_id: topic._id,
            post_id:  new_post._id,
            post_hid: hid,
            text:     post.pagetext
          });

          callback();
        });
      }, function (err) {
        if (err) {
          callback(err);
          return;
        }

        post_bulk.execute(function (err) {
          if (err) {
            callback(err);
            return;
          }

          map_bulk.execute(callback);
        });
      });
    }


    // Update created topic
    //
    function update_topic(callback) {
      // each fetched post is assigned a consecutive hid starting with 1,
      // so the last hid will be equal to the number of posts
      topic.last_post_hid = posts.length;

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

      var bar = progress(' topics :current/:total [:bar] :percent', rows.length);

      async.eachLimit(rows, 100, function (row, callback) {
        import_topic(row.threadid, function () {
          bar.tick();
          callback.apply(null, arguments);
        });
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


  // Link posts that reply to a different topic
  //
  function link_foreign_replies(callback) {
    conn.query('SELECT post.postid,post.parentid ' +
        'FROM post JOIN post AS parent ' +
        'ON (post.parentid = parent.postid AND post.threadid != parent.threadid)',
        function (err, rows) {

      if (err) {
        callback(err);
        return;
      }

      async.eachLimit(rows, 100, function (row, callback) {
        N.models.vbconvert.PostMapping.findOne({ mysql_id: row.postid })
            .lean(true)
            .exec(function (err, post_mapping) {

          if (err) {
            callback(err);
            return;
          }

          N.models.vbconvert.PostMapping.findOne({ mysql_id: row.parentid })
              .lean(true)
              .exec(function (err, parent_post_mapping) {

            if (err) {
              callback(err);
              return;
            }

            N.models.forum.Post.findOne({
              topic: parent_post_mapping.topic_id,
              hid: parent_post_mapping.post_hid
            }).lean(true).exec(function (err, post) {
              if (err) {
                callback(err);
                return;
              }

              N.models.forum.Topic.findById(post.topic)
                  .lean(true)
                  .exec(function (err, topic) {

                if (err) {
                  callback(err);
                  return;
                }

                N.models.forum.Section.findById(topic.section)
                    .lean(true)
                    .exec(function (err, section) {

                  if (err) {
                    callback(err);
                    return;
                  }

                  N.models.forum.Post.update({
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
                  }, callback);
                });
              });
            });
          });
        });
      }, callback);
    });
  }


  async.series([
    get_users,
    get_sections,
    get_connection,
    import_all_topics,
    link_foreign_replies
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
