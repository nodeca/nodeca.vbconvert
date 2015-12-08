'use strict';


var Mongoose = require('mongoose');
var Schema   = Mongoose.Schema;


module.exports = function (N, collectionName) {

  var statuses = {
    SUCCESS:     2,
    ERROR_RETRY: 3, // errors that we can recover from by retrying (TIMEOUT, etc.)
    ERROR_FATAL: 4  // errors that we can't recover from (401, 403, 404)
  };

  var ImageFetchLog = new Schema({
    url:     String,
    post_id: Schema.Types.ObjectId,

    // status (see above)
    status:  Number,

    // text of the error message (if any)
    error:   String
  }, {
    versionKey: false
  });


  // Indexes
  //////////////////////////////////////////////////////////////////////////////

  ImageFetchLog.index({ post_id: 1 });


  // Export statuses
  //
  ImageFetchLog.statics.statuses = statuses;


  N.wire.on('init:models', function emit_init_ImageFetchLog(__, callback) {
    N.wire.emit('init:models.' + collectionName, ImageFetchLog, callback);
  });


  N.wire.on('init:models.' + collectionName, function init_model_ImageFetchLog(schema) {
    N.models[collectionName] = Mongoose.model(collectionName, schema);
  });
};
