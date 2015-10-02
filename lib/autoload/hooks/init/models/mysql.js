// Init mysql connection and store it in `N.vbconvert.mysql`
//


'use strict';

var mysql = require('mysql');


module.exports = function (N) {

  N.wire.before('init:models', function vbconvert_mysql_init(N) {
    var pool;

    N.vbconvert = N.vbconvert || {};

    N.vbconvert.getConnection = function (callback) {
      if (!pool) {
        pool = mysql.createPool(N.config.vbconvert.database);
      }

      pool.getConnection(callback);
    }
  });
};
