// Download meta for all images referenced in forum posts
//
'use strict';


const _        = require('lodash');
const Promise  = require('bluebird');
const co       = require('bluebird-co').co;
const ObjectId = require('mongoose').Types.ObjectId;
const get_size = require('probe-image-size');

const POSTS_PER_CHUNK = 1000;


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

      * map() {
        let runid = Date.now();

        //
        // Select first and last posts from Posts collection,
        // and split range between them into chunks
        //

        // find first post id
        let first_post = yield N.models.forum.Post
                                             .findOne()
                                             .select('_id')
                                             .sort({ _id: 1 })
                                             .lean(true);

        // find last post id
        let last_post  = yield N.models.forum.Post
                                             .findOne()
                                             .select('_id')
                                             .sort({ _id: -1 })
                                             .lean(true);

        if (!first_post || !last_post) {
          return [];
        }

        const MSEC_MONTHLY = 30 * 24 * 60 * 60 * 1000;

        // find an amount of posts created last month
        let last_month_id = new ObjectId((last_post._id.getTimestamp() - MSEC_MONTHLY) / 1000);
        let monthly_post_count = yield N.models.forum.Post
                                                     .where('_id').gte(last_month_id)
                                                     .count();

        // we want to process around 1000 posts per chunk,
        // so calculate the post rate based on last month
        let delta  = POSTS_PER_CHUNK / monthly_post_count * MSEC_MONTHLY;

        let chunks = [];
        let from   = first_post._id.getTimestamp().valueOf() - 1;
        let to     = last_post._id.getTimestamp().valueOf() + 1;
        let fromid = null;
        let toid   = new ObjectId(from / 1000);

        for (let ts = from; ts <= to; ts += delta) {
          fromid = toid;
          toid = new ObjectId((ts + delta) / 1000);

          chunks.push({
            from:  fromid.toString(),
            to:    toid.toString(),
            runid
          });
        }

        return chunks;
      },

      * process() {
        let posts = yield N.models.forum.Post
                                        .where('_id').gte(this.data.from)
                                        .where('_id').lte(this.data.to)
                                        .lean(true);

        N.logger.info('Fetching images from posts range ' +
          this.data.from + '-' + this.data.to + ' (found ' + posts.length + ')');

        let images = [];

        posts.forEach(function (post) {
          if (!post || !_.isObject(post.image_info)) return;

          Object.keys(post.image_info).forEach(function (key) {
            // if it's not an external image (e.g. attachment), skip
            if (!key.match(/^url:/)) return;

            // if it's already loaded, skip
            if (post.image_info[key]) return;

            // key is "prefix"+"url with replaced dots", example:
            // url:http://example．com/foo．jpg
            let url = key.slice(4).replace(/．/g, '.');

            images.push({ post, url, key });
          });
        });

        const extendDeadline = _.throttle(() => this.setDeadline(), 10000);

        yield Promise.map(images, co.wrap(function* (image) {
          extendDeadline();

          let url = image.url;
          let key = image.key;
          let post = image.post;
          let result;
          let log = { url, post_id: post._id };
          let updateData = {};
          let err;

          try {
            result = yield get_size(url);
          } catch (_err) {
            err = _err;
          }

          if (err) {
            let url_failed = (err.code === 'ECONTENT') ||
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
          yield N.models.vbconvert.ImageFetchLog.collection.update(
            { url, post_id: post._id },
            log,
            { upsert: true }
          );

          yield N.models.forum.Post.update(
            { _id: post._id },
            { $set: updateData }
          );
        }), { concurrency: 100 });

        //
        // Send stat update to client
        //

        let data = yield this.task.worker.status(this.task.id);

        if (data) {
          let task_info = {
            current: data.chunks.done + data.chunks.errored,
            total:   data.chunks.done + data.chunks.errored +
                     data.chunks.active + data.chunks.pending,
            runid:   this.data.runid
          };

          N.live.debounce('admin.vbconvert.forum_images', task_info);
        }

        return this.data.runid;
      },

      reduce(chunksResult) {
        var task_info = {
          current: 1,
          total:   1,
          runid:   chunksResult[0] || 0
        };

        N.live.emit('admin.vbconvert.forum_images', task_info);
      }
    });
  });
};
