'use strict';


const Mongoose = require('mongoose');
const Schema   = Mongoose.Schema;


module.exports = function (N, collectionName) {

  let BlogCategoryMapping = new Schema({
    mysql: Number,
    mongo: Schema.ObjectId
  }, {
    versionKey: false
  });


  // Indexes
  //////////////////////////////////////////////////////////////////////////////

  BlogCategoryMapping.index({ mysql: 1 }, { unique: true });


  N.wire.on('init:models', function emit_init_BlogCategoryMapping(__, callback) {
    N.wire.emit('init:models.' + collectionName, BlogCategoryMapping, callback);
  });


  N.wire.on('init:models.' + collectionName, function init_model_BlogCategoryMapping(schema) {
    N.models[collectionName] = Mongoose.model(collectionName, schema);
  });
};
