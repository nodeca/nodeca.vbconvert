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
    require('./_lib/usergroups'),
    require('./_lib/users'),
    require('./_lib/sections'),
    require('./_lib/section_perms'),
    require('./_lib/topics'),
    require('./_lib/section_cache'),
    require('./_lib/votes'),
    require('./_lib/albums'),
    require('./_lib/avatars'),
    require('./_lib/files')
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
