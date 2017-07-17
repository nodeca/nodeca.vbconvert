'use strict';


const Mongoose = require('mongoose');
const Schema   = Mongoose.Schema;


module.exports = function (N, collectionName) {

  let BlogTextMapping = new Schema({
    blogid:     Number,
    blogtextid: Number,
    is_comment: Boolean,
    mongo:      Schema.ObjectId,
    text:       String
  }, {
    versionKey: false
  });


  // Indexes
  //////////////////////////////////////////////////////////////////////////////

  // Lookup text by id
  BlogTextMapping.index({ blogtextid: 1 }, { unique: true });


  N.wire.on('init:models', function emit_init_BlogTextMapping(__, callback) {
    N.wire.emit('init:models.' + collectionName, BlogTextMapping, callback);
  });


  N.wire.on('init:models.' + collectionName, function init_model_BlogTextMapping(schema) {
    N.models[collectionName] = Mongoose.model(collectionName, schema);
  });
};
