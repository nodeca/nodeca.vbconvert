'use strict';


var Mongoose = require('mongoose');
var Schema   = Mongoose.Schema;


module.exports = function (N, collectionName) {

  var FileMapping = new Schema({
    attachmentid:      Number,
    filedataid:        Number,

    // old attachment id from picturelegacy (optional)
    pictureaid_legacy: Number,

    // old attachment id from blog_attachmentlegacy (optional)
    blogaid_legacy:    Number,

    media_id:          Schema.Types.ObjectId
  }, {
    versionKey: false
  });


  // Indexes
  //////////////////////////////////////////////////////////////////////////////

  FileMapping.index({ attachmentid: 1 }, { unique: true });
  FileMapping.index({ filedataid: 1 });
  FileMapping.index({ pictureaid_legacy: 1 });
  FileMapping.index({ blogaid_legacy: 1 });


  N.wire.on('init:models', function emit_init_FileMapping(__, callback) {
    N.wire.emit('init:models.' + collectionName, FileMapping, callback);
  });


  N.wire.on('init:models.' + collectionName, function init_model_FileMapping(schema) {
    N.models[collectionName] = Mongoose.model(collectionName, schema);
  });
};
