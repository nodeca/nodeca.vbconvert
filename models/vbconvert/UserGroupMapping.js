'use strict';


var Mongoose = require('mongoose');
var Schema   = Mongoose.Schema;


module.exports = function (N, collectionName) {

  var UserGroupMapping = new Schema({
    mysql: Number,
    mongo: Schema.Types.ObjectId
  }, {
    versionKey: false
  });


  // Indexes
  //////////////////////////////////////////////////////////////////////////////

  // Ensure the group won't be imported twice
  UserGroupMapping.index({ mysql: 1 }, { unique: true });


  N.wire.on('init:models', function emit_init_UserGroupMapping(__, callback) {
    N.wire.emit('init:models.' + collectionName, UserGroupMapping, callback);
  });


  N.wire.on('init:models.' + collectionName, function init_model_UserGroupMapping(schema) {
    N.models[collectionName] = Mongoose.model(collectionName, schema);
  });
};
