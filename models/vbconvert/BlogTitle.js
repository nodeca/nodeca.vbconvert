// This model is created to avoid data loss when converting titles
// (html_unescape), currently not used anywhere.

'use strict';


const Mongoose = require('mongoose');
const Schema   = Mongoose.Schema;


module.exports = function (N, collectionName) {

  let BlogTitle = new Schema({
    mysql: Number,
    title: String
  }, {
    versionKey: false
  });


  N.wire.on('init:models', function emit_init_BlogTitle(__, callback) {
    N.wire.emit('init:models.' + collectionName, BlogTitle, callback);
  });


  N.wire.on('init:models.' + collectionName, function init_model_BlogTitle(schema) {
    N.models[collectionName] = Mongoose.model(collectionName, schema);
  });
};
