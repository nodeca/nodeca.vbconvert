// Convert bbcode to markdown and rebuild post
//
'use strict';


var _             = require('lodash');
var async         = require('async');
var url           = require('url');
var tokenize      = require('nodeca.vbconvert/lib/bbcode/tokenize');
var to_md         = require('nodeca.vbconvert/lib/bbcode/format_md');
var get_resources = require('nodeca.vbconvert/lib/bbcode/resources');

// amount of posts in a chunk
var BLOCK_SIZE = 1000;


module.exports = function (N) {
  var parsedUrl, linkDefaults;

  if (N.config.vbconvert.destination) {
    parsedUrl = url.parse(N.config.vbconvert.destination, null, true);
    linkDefaults = {
      protocol: parsedUrl.protocol ? parsedUrl.protocol.replace(/:$/, '') : null,
      hostname: parsedUrl.host
    };
  }

  function get_topic_urls(ids, callback) {
    if (!ids.length) {
      callback(null, {});
      return;
    }

    N.models.forum.Topic
        .find({ hid: { $in: _.uniq(ids) } })
        .select('hid section')
        .lean(true)
        .exec(function (err, topics) {

      if (err) {
        callback(err);
        return;
      }

      var topics_by_hid = {};

      topics.forEach(function (topic) {
        topics_by_hid[topic.hid] = topic;
      });

      N.models.forum.Section
          .find({ _id: {
            $in: _.uniq(_.pluck(topics, 'section').map(String))
          } })
          .select('hid')
          .lean(true)
          .exec(function (err, sections) {

        if (err) {
          callback(err);
          return;
        }

        var sections_by_id = {};

        sections.forEach(function (section) {
          sections_by_id[section._id] = section;
        });

        var result = {};

        ids.forEach(function (topic_hid) {
          result[topic_hid] = N.router.linkTo('forum.topic', {
            section_hid: topics_by_hid[topic_hid] ?
                           sections_by_id[topics_by_hid[topic_hid].section].hid :
                           1,
            topic_hid:   topic_hid
          }, linkDefaults);
        });

        callback(null, result);
      });
    });
  }

  function get_post_urls(ids, callback) {
    if (!ids.length) {
      callback(null, {});
      return;
    }

    N.models.vbconvert.PostMapping
        .find({ mysql_id: { $in: _.uniq(ids) } })
        .lean(true)
        .exec(function (err, post_mappings) {

      if (err) {
        callback(err);
        return;
      }

      N.models.forum.Topic
          .find({ _id: {
            $in: _.uniq(_.pluck(post_mappings, 'topic_id').map(String))
          } })
          .select('hid section')
          .lean(true)
          .exec(function (err, topics) {

        if (err) {
          callback(err);
          return;
        }

        var topics_by_id = {};

        topics.forEach(function (topic) {
          topics_by_id[topic._id] = topic;
        });

        N.models.forum.Section
            .find({ _id: {
              $in: _.uniq(_.pluck(topics, 'section').map(String))
            } })
            .select('hid')
            .lean(true)
            .exec(function (err, sections) {

          if (err) {
            callback(err);
            return;
          }

          var sections_by_id = {};

          sections.forEach(function (section) {
            sections_by_id[section._id] = section;
          });

          var result = {};

          post_mappings.forEach(function (post) {
            result[post.mysql_id] = N.router.linkTo('forum.topic', {
              section_hid: sections_by_id[topics_by_id[post.topic_id].section].hid,
              topic_hid:   topics_by_id[post.topic_id].hid,
              post_hid:    post.post_hid
            }, linkDefaults);
          });

          callback(null, result);
        });
      });
    });
  }

  function get_attachment_urls(ids, callback) {
    if (!ids.length) {
      callback(null, {});
      return;
    }

    N.models.vbconvert.FileMapping
        .find({ mysql: { $in: _.uniq(ids) } })
        .lean(true)
        .exec(function (err, file_mappings) {

      if (err) {
        callback(err);
        return;
      }

      N.models.users.MediaInfo
          .find({ _id: {
            $in: _.uniq(_.pluck(file_mappings, 'mongo').map(String))
          } })
          .select('user_id media_id')
          .lean(true)
          .exec(function (err, mediainfos) {

        if (err) {
          callback(err);
          return;
        }

        var media_by_id = {};

        mediainfos.forEach(function (media) {
          media_by_id[media._id] = media;
        });

        N.models.users.User
            .find({ _id: {
              $in: _.uniq(_.pluck(mediainfos, 'user_id').map(String))
            } })
            .select('hid')
            .lean(true)
            .exec(function (err, users) {

          if (err) {
            callback(err);
            return;
          }

          var users_by_id = {};

          users.forEach(function (user) {
            users_by_id[user._id] = user;
          });

          var result = {};

          file_mappings.forEach(function (file) {
            result[file.mysql] = N.router.linkTo('users.media', {
              user_hid: users_by_id[media_by_id[file.mongo].user_id].hid,
              media_id: media_by_id[file.mongo].media_id
            });
          });

          callback(null, result);
        });
      });
    });
  }

  N.wire.on('init:jobs', function register_vbconvert_rebuild() {
    N.queue.registerWorker({
      name: 'vbconvert_rebuild',

      // static id to make sure it will never be executed twice at the same time
      taskID: function () {
        return 'vbconvert_rebuild';
      },

      chunksPerInstance: 1,

      map: function (callback) {
        N.models.vbconvert.PostMapping
            .find()
            .select('mysql_id')
            .sort({ mysql_id: -1 })
            .limit(1)
            .lean(true)
            .exec(function (err, posts) {

          if (err) {
            callback(err);
            return;
          }

          var chunks = [];

          for (var i = 0; i < posts[0].mysql_id; i += BLOCK_SIZE) {
            chunks.push([ i, i + BLOCK_SIZE - 1 ]);
          }

          callback(null, chunks);
        });
      },

      process: function (callback) {
        N.models.vbconvert.PostMapping
            .where('mysql_id').gte(this.data[0])
            .where('mysql_id').lte(this.data[1])
            .lean(true)
            .exec(function (err, postmappings) {

          if (err) {
            callback(err);
            return;
          }

          if (!postmappings.length) {
            callback();
            return;
          }

          var posts = [];
          var resources = { posts: [], topics: [], attachments: [] };

          postmappings.forEach(function (p) {
            var tokens = tokenize(p.text);
            var res    = get_resources(tokens);

            resources.posts = resources.posts.concat(res.posts);
            resources.topics = resources.topics.concat(res.topics);
            resources.attachments = resources.attachments.concat(res.attachments);

            posts.push({
              id:     p.post_id,
              tokens: tokenize(p.text)
            });
          });

          async.parallel([
            get_post_urls.bind(null, resources.posts),
            get_topic_urls.bind(null, resources.topics),
            get_attachment_urls.bind(null, resources.attachments)
          ], function (err, results) {
            if (err) {
              callback(err);
              return;
            }

            var post_urls = results[0];
            var topic_urls = results[1];
            var attach_urls = results[2];

            async.eachLimit(posts, 50, function (post, callback) {
              var imports = [];
              var res     = get_resources(post.tokens);

              res.posts.forEach(function (postid) {
                imports.push(post_urls[postid]);
              });

              res.topics.forEach(function (topicid) {
                imports.push(topic_urls[topicid]);
              });

              N.models.forum.Post.update(
                  { _id: post.id },
                  { $set: {
                    md: to_md(post.tokens, {
                      posts:       post_urls,
                      topics:      topic_urls,
                      attachments: attach_urls
                    }),
                    imports: _.uniq(imports.sort(), true)
                  } },
                  function (err) {

                if (err) {
                  callback(err);
                  return;
                }

                N.wire.emit('internal:forum.post_rebuild', post.id, callback);
              });
            }, callback);
          });
        });
      },

      reduce: function (__, callback) {
        callback();
      }
    });
  });
};
