// Mapping for private messages
//

'use strict';


var Mongoose = require('mongoose');
var Schema   = Mongoose.Schema;


// Note: one `pm` from mysql may be represented with multiple copies
// of the same message directed to multiple users (with CC involved)
//
// i.e.:
//  - one `pmtext` = many `pm` (one copy for each user)
//  - one `pm` = many PMMapping (message copied into multiple dialogs, one for each recipient)
//  - one PMMapping = one users.DlgMessage
//
module.exports = function (N, collectionName) {

  var PMMapping = new Schema({
    pmid:      Number,
    to_user:   Number,

    pmtextid:  Number,
    message:   Schema.Types.ObjectId,
    common_id: Schema.Types.ObjectId,

    // unused
    title:     String,

    // original post text as it was in vb (with bbcode)
    text:      String
  }, {
    versionKey: false
  });


  // Indexes
  //////////////////////////////////////////////////////////////////////////////

  // Ensure the message won't be imported twice
  PMMapping.index({ pmid: 1, to_user: 1 }, { unique: true });

  // Find common_id for a message during import
  PMMapping.index({ pmtextid: 1 });


  N.wire.on('init:models', function emit_init_PMMapping(__, callback) {
    N.wire.emit('init:models.' + collectionName, PMMapping, callback);
  });


  N.wire.on('init:models.' + collectionName, function init_model_PMMapping(schema) {
    N.models[collectionName] = Mongoose.model(collectionName, schema);
  });
};
