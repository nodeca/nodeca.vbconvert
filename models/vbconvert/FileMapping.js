'use strict';


var Mongoose = require('mongoose');
var Schema   = Mongoose.Schema;


module.exports = function (N, collectionName) {

  var FileMapping = new Schema({
    mysql: Number,
    mongo: Schema.Types.ObjectId
  }, {
    versionKey: false
  });


  // Indexes
  //////////////////////////////////////////////////////////////////////////////

  FileMapping.index({ mysql: 1 }, { unique: true });


  N.wire.on('init:models', function emit_init_FileMapping(__, callback) {
    N.wire.emit('init:models.' + collectionName, FileMapping, callback);
  });


  N.wire.on('init:models.' + collectionName, function init_model_FileMapping(schema) {
    N.models[collectionName] = Mongoose.model(collectionName, schema);
  });
};
