// Convert bbcode to markdown in private messages
//
'use strict';


const _        = require('lodash');
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

      async init() {
        let query = N.models.vbconvert.PMMapping.countDocuments();

        if (this.args.length < 1 || !this.args[0]) {
          // if no min _id
          let min_post = await N.models.vbconvert.PMMapping.findOne()
                                  .select('pmid')
                                  .sort({ pmid: 1 })
                                  .lean(true);

          if (!min_post) {
            this.total = 0;
            return;
          }

          this.args[0] = String(min_post.pmid);
        } else {
          // min _id already specified
          // (if it's not, we count all posts without extra conditions,
          // which results in faster query)
          query = query.where('pmid').gte(this.args[0]);
        }

        if (this.args.length < 2 || !this.args[1]) {
          // if no max _id
          let max_post = await N.models.vbconvert.PMMapping.findOne()
                                  .select('pmid')
                                  .sort({ pmid: -1 })
                                  .lean(true);

          if (!max_post) {
            this.total = 0;
            return;
          }

          this.args[1] = String(max_post.pmid);
        } else {
          // max _id already specified
          query = query.where('pmid').lte(this.args[1]);
        }

        let post_count = await query;

        this.total = Math.ceil(post_count / CHUNK_SIZE);
      },

      async iterate(state) {
        if (this.total === 0) return null;

        let active_chunks = this.children_created - this.children_finished;


        // Idle if we still have more than `CHUNKS_MIN_COUNT` chunks
        //
        if (active_chunks >= CHUNKS_MIN_COUNT) return {};


        // Fetch posts _id
        //
        let query = N.models.vbconvert.PMMapping.find()
                        .where('pmid').gte(this.args[0]) // min
                        .select('pmid')
                        .sort({ pmid: -1 })
                        .limit(CHUNK_SIZE * CHUNKS_TO_ADD)
                        .lean(true);

        // If state is present it is always smaller than max _id
        if (state) {
          query.where('pmid').lt(state);
        } else {
          query.where('pmid').lte(this.args[1]); // max
        }

        let posts = await query;


        // Check finished
        //
        if (!posts.length) return;


        // Add chunks
        //
        let chunks = _.chunk(posts.map(p => String(p.pmid)), CHUNK_SIZE)
          .map(ids => N.queue.vbconvert_messages_import_chunk(ids));

        return {
          tasks: chunks,
          state: String(posts[posts.length - 1].pmid)
        };
      }
    });


    // Chunk
    //
    N.queue.registerTask({
      name: 'vbconvert_messages_import_chunk',
      pool: 'hard',
      removeDelay: 3600,
      async process(ids) {
        let start_time = Date.now();

        N.logger.info(`Importing dialogs ${ids[0]}-${ids[ids.length - 1]} - ${ids.length} - started`);

        // fetch source text (bbcode) for posts
        let mappings = await N.models.vbconvert.PMMapping
                                .where('pmid').in(ids)
                                .lean(true);

        // fetch messages
        let posts = await N.models.users.DlgMessage.find({
          _id: { $in: _.map(mappings, 'message') }
        }).lean(true);

        let dialogs = await N.models.users.Dialog.find({
          _id: { $in: _.map(posts, 'parent') }
        }).lean(true);

        let users = await N.models.users.User.find({
          _id: {
            $in: _.uniq([].concat(_.map(dialogs, 'user'))
                          .concat(_.map(dialogs, 'to'))
                          .filter(Boolean).map(String))
          }
        }).lean(true);

        let mappings_by_id = _.keyBy(mappings, mapping => `${mapping.pmid}_${mapping.to_user}`);
        let posts_by_id    = _.keyBy(posts, '_id');
        let dialogs_by_id  = _.keyBy(dialogs, '_id');
        let users_by_id    = _.keyBy(users, '_id');
        let bbcode_data    = [];

        for (let mapping of mappings) {
          let post = posts_by_id[mapping.message];

          // Skip posts missing from the database (e.g. after mongo database repair)
          if (!post) {
            N.logger.error(`Cannot find message (id=${mapping.message}, pmid=${mapping.pmid})`);
            continue;
          }

          let dialog = dialogs_by_id[post.parent];

          if (!dialog) {
            N.logger.error(`Cannot find dialog (id=${post.parent}, message=${post._id})`);
            continue;
          }

          let params = await N.models.core.MessageParams.getParams(post.params_ref);

          bbcode_data.push({
            id:          `${mapping.pmid}_${mapping.to_user}`,
            text:        mapping.text,
            options:     params,
            users:       [ users_by_id[dialog.user], users_by_id[dialog.to] ].filter(Boolean),
            attachments: [] // filled in only for forum posts and blog entries
          });
        }

        let parsed = await parse_bbcode(bbcode_data);

        let bulk = N.models.users.DlgMessage.collection.initializeUnorderedBulkOp();

        for (let result of parsed) {
          let updateData = {
            $set: { md: result.md }
          };

          bulk.find({ _id: mappings_by_id[result.id].message })
              .update(updateData);
        }

        if (bulk.length > 0) await bulk.execute();


        N.logger.info(`Importing dialogs ${ids[0]}-${ids[ids.length - 1]} - ${ids.length} - finished (${
          ((Date.now() - start_time) / 1000).toFixed(1)
          }s)`);
      }
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
