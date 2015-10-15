'use strict';


var Mongoose = require('mongoose');
var Schema   = Mongoose.Schema;


module.exports = function (N, collectionName) {

  var AlbumMapping = new Schema({
    mysql: Number,
    mongo: Schema.Types.ObjectId
  }, {
    versionKey: false
  });


  // Indexes
  //////////////////////////////////////////////////////////////////////////////

  AlbumMapping.index({ mysql: 1 }, { unique: true });


  N.wire.on('init:models', function emit_init_AlbumMapping(__, callback) {
    N.wire.emit('init:models.' + collectionName, AlbumMapping, callback);
  });


  N.wire.on('init:models.' + collectionName, function init_model_AlbumMapping(schema) {
    N.models[collectionName] = Mongoose.model(collectionName, schema);
  });
};
