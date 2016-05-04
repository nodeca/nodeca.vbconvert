// Mapping for private messages
//

'use strict';


var Mongoose = require('mongoose');
var Schema   = Mongoose.Schema;


module.exports = function (N, collectionName) {

  var PMMapping = new Schema({
    mysql:   Number,
    to_user: Number,
    dialog:  Schema.Types.ObjectId,
    message: Schema.Types.ObjectId,

    // original post text as it was in vb (with bbcode)
    text: String
  }, {
    versionKey: false
  });


  // Indexes
  //////////////////////////////////////////////////////////////////////////////

  // Ensure the message won't be imported twice
  PMMapping.index({ mysql: 1, to_user: 1 }, { unique: true });


  N.wire.on('init:models', function emit_init_PMMapping(__, callback) {
    N.wire.emit('init:models.' + collectionName, PMMapping, callback);
  });


  N.wire.on('init:models.' + collectionName, function init_model_PMMapping(schema) {
    N.models[collectionName] = Mongoose.model(collectionName, schema);
  });
};
