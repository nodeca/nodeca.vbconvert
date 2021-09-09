// rcd_log_pm table imported as is

'use strict';


const Mongoose = require('mongoose');
const Schema   = Mongoose.Schema;


module.exports = function (N, collectionName) {

  let OldRcdPmLog = new Schema({
    logid:         Number,
    pmid:          Number,
    pmtextid:      Number,
    fromuserip:    String,
    fromuserid:    Number,
    fromusername:  String,
    fromuseremail: String,
    touserid:      Number,
    tousername:    String,
    touseremail:   String,
    title:         String,
    message:       String,
    iconid:        Number,
    dateline:      Number,
    showsignature: Number,
    allowsmilie:   Number
  }, {
    versionKey: false
  });


  N.wire.on('init:models', function emit_init_OldRcdPmLog(__, callback) {
    N.wire.emit('init:models.' + collectionName, OldRcdPmLog, callback);
  });


  N.wire.on('init:models.' + collectionName, function init_model_OldRcdPmLog(schema) {
    N.models[collectionName] = Mongoose.model(collectionName, schema);
  });
};
