// Convert forum database from vBulletin to Nodeca
//

'use strict';

var async    = require('async');


////////////////////////////////////////////////////////////////////////////////


module.exports.parserParameters  = {
  addHelp:      true,
  help:         'import data from vBulletin',
  description:  'Import data from vBulletin'
};


module.exports.commandLineArguments = [
];


module.exports.run = function (N, args, callback) {
  var modules = [
    require('./lib/usergroups'),
    require('./lib/users'),
    require('./lib/sections'),
    require('./lib/section_perms'),
    require('./lib/topics'),
    require('./lib/section_cache'),
    require('./lib/albums'),
    require('./lib/files'),
    require('./lib/avatars')
  ];

  N.wire.emit([ 'init:models' ], N, function (err) {
    if (err) {
      callback(err);
      return;
    }

    async.mapSeries(modules, function (fn, next) {
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
