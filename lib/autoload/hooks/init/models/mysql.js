// Init mysql connection and store it in `N.vbconvert.mysql`
//


'use strict';


const _        = require('lodash');
const Promise  = require('bluebird');
const mysql    = require('mysql2/promise');


module.exports = function (N) {

  N.wire.before('init:models', function vbconvert_mysql_init(N) {
    let pool;

    N.vbconvert = N.vbconvert || {};

    N.vbconvert.getConnection = function () {
      if (!pool) {
        pool = mysql.createPool({
          uri: N.config.vbconvert.database || 'mysql://root@localhost/vbforum',
          connectionLimit: 4,
          Promise
        });
      }

      return pool.getConnection();
    };
  });
};
