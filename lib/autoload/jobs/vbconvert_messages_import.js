// Convert bbcode to markdown in private messages
//
'use strict';


const _        = require('lodash');
const Promise  = require('bluebird');
const crypto   = require('crypto');

// amount of posts in a chunk
const CHUNK_SIZE = 200;


module.exports = function (N) {
  const parse_bbcode = require('../../parse_bbcode')(N);

  N.wire.on('init:jobs', function register_vbconvert_messages_import() {
    N.queue.registerWorker({
      name: 'vbconvert_messages_import',

      // static id to make sure it will never be executed twice at the same time
      taskID(data) {
        return Array.isArray(data) ?
               crypto.randomBytes(20).toString('hex') :
               'vbconvert_messages_import';
      },

      chunksPerInstance: 1,

      timeout: 60000,

      * map() {
        let runid = Date.now();

        // Rebuild selected posts using data = [ 123, 456 ],
        // where id is an id from the old forum. Used for debug purposes only.
        //
        if (Array.isArray(this.data)) {
          return this.data.map(id => ({ from: id, to: id, runid }));
        }

        let last_post = yield N.models.vbconvert.PMMapping
                                                .findOne()
                                                .select('mysql')
                                                .sort('-mysql')
                                                .lean(true);
        let chunks = [];

        for (let i = 0; i <= last_post.mysql; i += CHUNK_SIZE) {
          chunks.push({ from: i, to: i + CHUNK_SIZE - 1, runid });
        }

        N.logger.info(`Start parsing dialogs (${chunks.length} chunks)`);

        return chunks;
      },

      * process() {
        let start_time = Date.now();

        N.logger.info(`Importing dialogs ${this.data.from}-${this.data.to} - started`);

        // fetch source text (bbcode) for messages
        let mappings = yield N.models.vbconvert.PMMapping
                                .where('mysql').gte(this.data.from)
                                .where('mysql').lte(this.data.to)
                                .lean(true);

        // fetch parser params
        let posts = yield N.models.users.DlgMessage.find({
          _id: { $in: _.map(mappings, 'message') }
        }).lean(true);

        let mappings_by_id = _.keyBy(mappings, mapping => `${mapping.mysql}_${mapping.to_user}`);
        let posts_by_id    = _.keyBy(posts, '_id');
        let bbcode_data    = [];

        for (let mapping of mappings) {
          let post = posts_by_id[mapping.message];
          let params = yield N.models.core.MessageParams.getParams(post.params_ref);

          bbcode_data.push({
            id:          `${mapping.mysql}_${mapping.to_user}`,
            text:        mapping.text,
            options:     params,
            attachments: post.attach
          });
        }

        let parsed = yield parse_bbcode(bbcode_data);

        yield Promise.map(parsed, Promise.coroutine(function* (result) {
          let updateData = {
            md:   result.md,
            tail: result.tail,
            html: result.html
          };

          [ 'imports', 'import_users' ].forEach(function (field) {
            if (!_.isEmpty(result[field])) {
              updateData[field] = result[field];
            } else {
              updateData.$unset = updateData.$unset || {};
              updateData.$unset[field] = true;
            }
          });

          yield N.models.users.DlgMessage.update({ _id: mappings_by_id[result.id].message }, updateData);
        }), { concurrency: 50 });

        N.logger.info(`Importing dialogs ${this.data.from}-${this.data.to} - finished (${
          ((Date.now() - start_time) / 1000).toFixed(1)
        }s)`);

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

          N.live.debounce('admin.vbconvert.messages', task_info);
        }

        return this.data.runid;
      },

      reduce(chunksResult) {
        var task_info = {
          current: 1,
          total:   1,
          runid:   chunksResult[0] || 0
        };

        N.live.emit('admin.vbconvert.messages', task_info);

        N.logger.info('Finish parsing dialogs');
      }
    });
  });
};
