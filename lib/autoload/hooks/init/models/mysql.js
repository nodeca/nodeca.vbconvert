// Init mysql connection and store it in `N.vbconvert.mysql`
//


'use strict';


const _        = require('lodash');
const mysql    = require('mysql');
const thenify  = require('thenify');
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
    var pool;
    var database = N.config.vbconvert.database || 'mysql://root@localhost/vbforum';

    N.vbconvert = N.vbconvert || {};

    N.vbconvert.getConnection = thenify.withCallback(function (callback) {
      if (!pool) {
        pool = mysql.createPool(_.assign({}, parse_db_url(database), {
          connectionLimit: 4,
          insecureAuth: true
        }));
      }

      pool.getConnection((err, conn) => {
        if (err) {
          callback(err);
          return;
        }

        // return promisified connection object
        callback(null, {
          release: conn.release.bind(conn),
          query: function () {
            let args = Array.prototype.slice.call(arguments);

            if (typeof args[args.length - 1] === 'function') {
              // using callback interface
              return conn.query.apply(conn, args);
            }

            return new Promise((resolve, reject) => {
              args.push((err, rows) => {
                if (err) {
                  reject(err);
                  return;
                }
                resolve(rows);
              });

              conn.query.apply(conn, args);
            });
          }
        });
      });
    });
  });
};
