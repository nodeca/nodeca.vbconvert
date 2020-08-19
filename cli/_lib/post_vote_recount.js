// Recalculate votes for forum posts
//

'use strict';

const batch    = require('batch-stream');
const Mongoose = require('mongoose');
const stream   = require('stream');
const pipeline = require('util').promisify(stream.pipeline);
const progress = require('./utils').progress;
const Schema   = Mongoose.Schema;

const BATCH_SIZE = 10000;


module.exports = async function (N) {
  await N.models.users.Vote.aggregate([
    { $match: { type: N.shared.content_type.FORUM_POST } },
    {
      $project: {
        for: '$for',
        votes_hb: '$value',
        votes: { $cond: { if: { $eq: [ '$hb', true ] }, then: 0, else: '$value' } }
      }
    },
    {
      $group: {
        _id: '$for',
        votes: { $sum: '$votes' },
        votes_hb: { $sum: '$votes_hb' }
      }
    },
    { $out: 'vbconvert.post_vote_recount_tmp' }
  ]).allowDiskUse(true);


  let schema = new Schema({
    votes:    Number,
    votes_hb: Number
  }, {
    versionKey: false
  });

  let AggregationResult = Mongoose.model('PostVoteRecount', schema, 'vbconvert.post_vote_recount_tmp');

  async function process_chunk(chunk) {
    let bulk = N.models.forum.Post.collection.initializeUnorderedBulkOp();

    for (let result of chunk) {
      bulk.find({ _id: result._id })
          .update({ $set: {
            votes:    result.votes,
            votes_hb: result.votes_hb
          } });
    }

    if (bulk.length > 0) await bulk.execute();
  }

  let count = await AggregationResult.estimatedDocumentCount();
  let bar = progress(' post vote recount :current/:total :percent', count);

  await pipeline(
    AggregationResult.find()
        .sort('_id')
        .lean(true)
        .cursor(),

    batch({ size: BATCH_SIZE }),

    new stream.Writable({
      objectMode: true,
      highWaterMark: 2, // buffer 2 chunks at most
      write(chunk, __, callback) {
        process_chunk(chunk)
          .then(() => {
            bar.tick(chunk.length);
            callback();
          }, err => { callback(err); });
      }
    })
  );

  bar.terminate();

  await AggregationResult.collection.drop();

  N.logger.info('Post vote recount finished');
};
