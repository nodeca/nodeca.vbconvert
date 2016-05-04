'use strict';


var Mongoose = require('mongoose');
var Schema   = Mongoose.Schema;


module.exports = function (N, collectionName) {

  var PostMapping = new Schema({
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
  PostMapping.index({ mysql: 1 }, { unique: true });

  // Get post text by topic + hid
  PostMapping.index({ topic_id: 1, post_hid: 1 });


  N.wire.on('init:models', function emit_init_PostMapping(__, callback) {
    N.wire.emit('init:models.' + collectionName, PostMapping, callback);
  });


  N.wire.on('init:models.' + collectionName, function init_model_PostMapping(schema) {
    N.models[collectionName] = Mongoose.model(collectionName, schema);
  });
};
