// Mapping for private messages
//

'use strict';


var Mongoose = require('mongoose');
var Schema   = Mongoose.Schema;


module.exports = function (N, collectionName) {

  var PMMapping = new Schema({
    mysql:   Number,
    message: Schema.Types.ObjectId,

    // unused
    title:   String,

    // each message is inserted in the database twice (or more if CCs are
    // present), 1 mapping for each message
    //
    //  - user is the user that has inserted message
    //  - to is the other party for that message
    //
    // note: mapping does not store information about who wrote the message
    //
    user:    Number,
    to:      Number,

    // original post text as it was in vb (with bbcode)
    text:    String
  }, {
    versionKey: false
  });


  // Indexes
  //////////////////////////////////////////////////////////////////////////////

  // Ensure the message won't be imported twice
  PMMapping.index({ mysql: 1, user: 1, to: 1 }, { unique: true });


  N.wire.on('init:models', function emit_init_PMMapping(__, callback) {
    N.wire.emit('init:models.' + collectionName, PMMapping, callback);
  });


  N.wire.on('init:models.' + collectionName, function init_model_PMMapping(schema) {
    N.models[collectionName] = Mongoose.model(collectionName, schema);
  });
};
