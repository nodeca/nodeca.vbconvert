// This model is created to avoid data loss when converting titles
// (html_unescape), currently not used anywhere.

'use strict';


const Mongoose = require('mongoose');
const Schema   = Mongoose.Schema;


module.exports = function (N, collectionName) {

  let ClubTitle = new Schema({
    mysql: Number,
    title: String,
    description: String
  }, {
    versionKey: false
  });


  N.wire.on('init:models', function emit_init_ClubTitle(__, callback) {
    N.wire.emit('init:models.' + collectionName, ClubTitle, callback);
  });


  N.wire.on('init:models.' + collectionName, function init_model_ClubTitle(schema) {
    N.models[collectionName] = Mongoose.model(collectionName, schema);
  });
};
