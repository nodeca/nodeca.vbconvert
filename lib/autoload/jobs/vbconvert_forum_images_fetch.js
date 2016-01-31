// Download meta for all images referenced in forum posts
//
'use strict';


var _           = require('lodash');
var async       = require('async');
var ObjectId    = require('mongoose').Types.ObjectId;
var get_size    = require('probe-image-size');


module.exports = function (N) {
  N.wire.on('init:jobs', function register_vbconvert_forum_images_fetch() {
    N.queue.registerWorker({
      name: 'vbconvert_forum_images_fetch',

      // static id to make sure it will never be executed twice at the same time
      taskID() {
        return 'vbconvert_forum_images_fetch';
      },

      timeout: 120000,

      chunksPerInstance: 1,

      map(callback) {
        var runid = Date.now();

        //
        // Select first and last posts from Posts collection,
        // and split range between them into chunks
        //

        // find first post id
        N.models.forum.Post
            .find()
            .select('_id')
            .sort({ _id: 1 })
            .limit(1)
            .lean(true)
            .exec(function (err, first_post) {

          if (err) {
            callback(err);
            return;
          }

          // find last post id
          N.models.forum.Post
              .find()
              .select('_id')
              .sort({ _id: -1 })
              .limit(1)
              .lean(true)
              .exec(function (err, last_post) {

            if (err) {
              callback(err);
              return;
            }

            if (!first_post.length || !last_post.length) {
              callback(null, []);
              return;
            }

            var posts_per_chunk = 1000;
            var msec_monthly    = 30 * 24 * 60 * 60 * 1000;

            // find an amount of posts created last month
            N.models.forum.Post
                .where('_id').gte(new ObjectId((last_post[0]._id.getTimestamp() - msec_monthly) / 1000))
                .count(function (err, monthly_post_count) {

              if (err) {
                callback(err);
                return;
              }

              // we want to process around 1000 posts per chunk,
              // so calculate the post rate based on last month
              var delta  = posts_per_chunk / monthly_post_count * msec_monthly;

              var chunks = [];
              var from   = first_post[0]._id.getTimestamp().valueOf() - 1;
              var to     = last_post[0]._id.getTimestamp().valueOf() + 1;
              var fromid = null;
              var toid   = new ObjectId(from / 1000);

              for (var ts = from; ts <= to; ts += delta) {
                fromid = toid;
                toid = new ObjectId((ts + delta) / 1000);

                chunks.push({
                  from:  fromid.toString(),
                  to:    toid.toString(),
                  runid
                });
              }

              callback(null, chunks);
            });
          });
        });
      },

      /* eslint-disable max-nested-callbacks */
      process(callback) {
        var self = this;

        // Send stat update to client and finish task
        //
        function send_status_update(callback) {
          self.task.worker.status(self.task.id, function (err, data) {
            if (err) {
              callback(err);
              return;
            }

            if (!data) {
              // This should not happen, but required for safety
              callback(err);
              return;
            }

            var task_info = {
              current: data.chunks.done + data.chunks.errored,
              total:   data.chunks.done + data.chunks.errored +
                       data.chunks.active + data.chunks.pending,
              runid:   self.data.runid
            };

            N.live.debounce('admin.vbconvert.forum_images', task_info);

            callback(null, self.data.runid);
          });
        }

        N.models.forum.Post
            .where('_id').gte(self.data.from)
            .where('_id').lte(self.data.to)
            .lean(true)
            .exec(function (err, posts) {

          N.logger.info('Fetching images from posts range ' +
            self.data.from + '-' + self.data.to + ' (found ' + posts.length + ')');

          if (err) {
            callback(err);
            return;
          }

          if (!posts.length) {
            send_status_update(callback);
            return;
          }

          var images = [];

          posts.forEach(function (post) {
            if (!post || !_.isObject(post.image_info)) {
              return;
            }

            Object.keys(post.image_info).forEach(function (key) {
              if (!key.match(/^url:/)) {
                // if it's not an external image (e.g. attachment), skip
                return;
              }

              if (post.image_info[key]) {
                // if it's already loaded, skip
                return;
              }

              // key is "prefix"+"url with replaced dots", example:
              // url:http://example．com/foo．jpg
              var url = key.slice(4).replace(/．/g, '.');

              images.push({ post, url, key });
            });
          });

          var extendDeadline = _.throttle(function () {
            self.setDeadline();
          }, 10000);

          async.eachLimit(images, 100, function (image, _callback) {
            extendDeadline();

            var callback = _.once(_callback);
            var url = image.url;
            var key = image.key;
            var post = image.post;

            get_size(url, function (err, result) {
              var log = { url, post_id: post._id };
              var updateData = {};

              if (err) {
                var url_failed = (err.code === 'ECONTENT') ||
                                 (err.status && err.status >= 400 && err.status < 500);

                log.error = err.message;
                log.error_code = err.status || err.code;
                log.status = N.models.vbconvert.ImageFetchLog.statuses[url_failed ? 'ERROR_FATAL' : 'ERROR_RETRY'];

                if (url_failed) {
                  updateData['image_info.' + key] = { error: err.status || err.message };
                }
              } else {
                log.status = N.models.vbconvert.ImageFetchLog.statuses.SUCCESS;

                updateData['image_info.' + key] = _.omitBy({
                  width:  result.width,
                  height: result.height,
                  length: result.length
                }, _.isUndefined);
              }

              // The use of native update instead of mongoose wrapper is
              // intentional to avoid a mongoose design flaw, see details here:
              // https://coderwall.com/p/3publg/mongoose-s-update-does-not-behave-like-mongo-s-update
              //
              N.models.vbconvert.ImageFetchLog.collection.update(
                  { url, post_id: post._id },
                  log,
                  { upsert: true },
                  function (err) {

                if (err) {
                  callback(err);
                  return;
                }

                N.models.forum.Post.update(
                    { _id: post._id },
                    { $set: updateData },
                    function (err) {

                  if (err) {
                    callback(err);
                    return;
                  }

                  callback();
                });
              });
            }, callback);
          }, function (err) {
            if (err) {
              callback(err);
              return;
            }

            send_status_update(callback);
          });
        });
      },

      reduce(chunksResult, callback) {
        var task_info = {
          current: 1,
          total:   1,
          runid:   chunksResult[0] || 0
        };

        N.live.emit('admin.vbconvert.forum_images', task_info);

        callback();
      }
    });
  });
};
