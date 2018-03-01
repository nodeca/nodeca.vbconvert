'use strict';


const Mongoose = require('mongoose');
const Schema   = Mongoose.Schema;


module.exports = function (N, collectionName) {

  let ClubPostMapping = new Schema({
    mysql:    Number,
    topic_id: Schema.Types.ObjectId,
    post_id:  Schema.Types.ObjectId,
    post_hid: Number,

    // original post text as it was in vb (with bbcode)
    text: String
  }, {
    versionKey: false
  });


  // Indexes
  //////////////////////////////////////////////////////////////////////////////

  // Ensure the post won't be imported twice
  ClubPostMapping.index({ mysql: 1 }, { unique: true });

  // Get post text by topic + hid
  ClubPostMapping.index({ topic_id: 1, post_hid: 1 });


  N.wire.on('init:models', function emit_init_ClubPostMapping(__, callback) {
    N.wire.emit('init:models.' + collectionName, ClubPostMapping, callback);
  });


  N.wire.on('init:models.' + collectionName, function init_model_ClubPostMapping(schema) {
    N.models[collectionName] = Mongoose.model(collectionName, schema);
  });
};
