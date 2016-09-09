// Init mysql connection and store it in `N.vbconvert.mysql`
//


'use strict';


const _        = require('lodash');
const Promise  = require('bluebird');
const mysql    = require('mysql2/promise');
const url      = require('url');


function parse_db_url(u) {
  var parsed = url.parse(u, true, true);

  if (!parsed.slashes && u[0] !== '/') {
    u = '//' + u;
    parsed = url.parse(u, true, true);
  }

  parsed.host = parsed.host || 'localhost';
  parsed.user = (parsed.auth || '').split(':')[0];
  parsed.password = (parsed.auth || '').split(':')[1];
  parsed.database = (parsed.pathname || '/').slice(1);

  return parsed;
}


module.exports = function (N) {

  N.wire.before('init:models', function vbconvert_mysql_init(N) {
    let pool;
    let database = N.config.vbconvert.database || 'mysql://root@localhost/vbforum';

    N.vbconvert = N.vbconvert || {};

    N.vbconvert.getConnection = function () {
      if (!pool) {
        pool = mysql.createPool(_.assign({}, parse_db_url(database), {
          connectionLimit: 4,
          Promise
        }));
      }

      return pool.getConnection();
    };
  });
};
