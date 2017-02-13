// Convert bbcode to markdown in private messages
//
'use strict';


const _        = require('lodash');
const Promise  = require('bluebird');
const Queue    = require('idoit');


const CHUNKS_TO_ADD    = 100;
const CHUNKS_MIN_COUNT = 50;
// amount of posts in a chunk
const CHUNK_SIZE = 50;


module.exports = function (N) {
  const parse_bbcode = require('../../parse_bbcode')(N);

  N.wire.on('init:jobs', function register_vbconvert_messages_import() {
    // Iterator
    //
    N.queue.registerTask({
      name: 'vbconvert_messages_import',
      pool: 'hard',
      baseClass: Queue.IteratorTemplate,

      // static id to make sure it will never be executed twice at the same time
      taskID: () => 'vbconvert_messages_import',

      init: Promise.coroutine(function* () {
        let query = N.models.vbconvert.PMMapping.count();

        if (this.args.length < 1 || !this.args[0]) {
          // if no min _id
          let min_post = yield N.models.vbconvert.PMMapping.findOne()
                                  .select('mysql')
                                  .sort({ mysql: 1 })
                                  .lean(true);

          this.args[0] = String(min_post.mysql);
        } else {
          // min _id already specified
          // (if it's not, we count all posts without extra conditions,
          // which results in faster query)
          query = query.where('_id').gte(this.args[0]);
        }

        if (this.args.length < 2 || !this.args[1]) {
          // if no max _id
          let max_post = yield N.models.vbconvert.PMMapping.findOne()
                                  .select('mysql')
                                  .sort({ mysql: -1 })
                                  .lean(true);

          this.args[1] = String(max_post.mysql);
        } else {
          // max _id already specified
          query = query.where('_id').lte(this.args[1]);
        }

        let post_count = yield query;

        this.total = Math.ceil(post_count / CHUNK_SIZE);
      }),

      iterate: Promise.coroutine(function* (state) {
        let active_chunks = this.children_created - this.children_finished;


        // Idle if we still have more than `CHUNKS_MIN_COUNT` chunks
        //
        if (active_chunks >= CHUNKS_MIN_COUNT) return {};


        // Fetch posts _id
        //
        let query = N.models.vbconvert.PMMapping.find()
                        .where('mysql').gte(this.args[0]) // min
                        .select('mysql')
                        .sort({ mysql: -1 })
                        .limit(CHUNK_SIZE * CHUNKS_TO_ADD)
                        .lean(true);

        // If state is present it is always smaller than max _id
        if (state) {
          query.where('mysql').lt(state);
        } else {
          query.where('mysql').lte(this.args[1]); // max
        }

        let posts = yield query;


        // Check finished
        //
        if (!posts.length) return;


        // Add chunks
        //
        let chunks = _.chunk(posts.map(p => String(p.mysql)), CHUNK_SIZE)
          .map(ids => N.queue.vbconvert_messages_import_chunk(ids));

        return {
          tasks: chunks,
          state: String(posts[posts.length - 1].mysql)
        };
      })
    });


    // Chunk
    //
    N.queue.registerTask({
      name: 'vbconvert_messages_import_chunk',
      pool: 'hard',
      removeDelay: 3600,
      process: Promise.coroutine(function* (ids) {
        let start_time = Date.now();

        N.logger.info(`Importing dialogs ${ids[0]}-${ids[ids.length - 1]} - ${ids.length} - started`);

        // fetch source text (bbcode) for posts
        let mappings = yield N.models.vbconvert.PMMapping
                                .where('mysql').in(ids)
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

          // Skip posts missing from the database (e.g. after mongo database repair)
          if (!post) {
            N.logger.error(`Cannot find message (id=${mapping.post_id}, mysql=${mapping.mysql})`);
            continue;
          }

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


        N.logger.info(`Importing dialogs ${ids[0]}-${ids[ids.length - 1]} - ${ids.length} - finished (${
          ((Date.now() - start_time) / 1000).toFixed(1)
          }s)`);
      })
    });


    N.queue.on('task:progress:vbconvert_messages_import', function (task_info) {
      N.live.debounce('admin.vbconvert.messages', {
        uid:     task_info.uid,
        current: task_info.progress,
        total:   task_info.total
      });
    });


    N.queue.on('task:end:vbconvert_messages_import', function (task_info) {
      N.live.emit('admin.vbconvert.messages', {
        uid:      task_info.uid,
        finished: true
      });
    });
  });
};
