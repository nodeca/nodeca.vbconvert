// Convert forum database from vBulletin to Nodeca
//

'use strict';

var async    = require('async');
var fstools  = require('fs-tools');
var path     = require('path');


////////////////////////////////////////////////////////////////////////////////


module.exports.run = function (N, args, callback) {
  var modules = [
    require('./lib/usergroups'),
    require('./lib/users'),
    require('./lib/sections'),
    require('./lib/topics'),
    require('./lib/posts')
  ];

  N.wire.emit([ 'init:models' ], N, function (err) {
    if (err) {
      callback(err);
      return;
    }

    async.map(modules, function (fn, next) {
      fn(N, next);
    }, function (err) {
      if (err) {
        callback(err);
        return;
      }

      process.exit(0);
    });
  });
};
