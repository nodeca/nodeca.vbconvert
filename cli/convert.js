// Convert forum database from vBulletin to Nodeca
//

'use strict';

var async    = require('async');
var fstools  = require('fs-tools');
var path     = require('path');


////////////////////////////////////////////////////////////////////////////////


module.exports.run = function (N, args, callback) {
  var dirname = path.join(__dirname, '../db/convert');
  var converters = [];

  fstools.walkSync(dirname, /\d+_\w*\.js$/, function (file) {
    // skip:
    // - dirname in path starts with underscore, e.g. /foo/_bar/baz.js
    if (file.match(/(^|\/|\\)_/)) { return; }

    converters.push(require(file));
  });

  async.map(converters, function (fn, next) {
    fn(N, next);
  }, function (err) {
    if (err) {
      callback(err);
      return;
    }

    process.exit(0);
  });
};
