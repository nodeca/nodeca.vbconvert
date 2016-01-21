// Convert forum database from vBulletin to Nodeca
//

'use strict';

const co = require('co');


////////////////////////////////////////////////////////////////////////////////


module.exports.parserParameters  = {
  addHelp:      true,
  help:         'import data from vBulletin',
  description:  'Import data from vBulletin'
};


module.exports.commandLineArguments = [
];


module.exports.run = co.wrap(function* (N/*, args*/) {
  yield N.wire.emit([ 'init:models' ], N);

  yield require('./_lib/usergroups')(N);
  yield require('./_lib/users')(N);
  yield require('./_lib/sections')(N);
  yield require('./_lib/section_perms')(N);
  yield require('./_lib/topics')(N);
  yield require('./_lib/section_cache')(N);
  yield require('./_lib/votes')(N);
  yield require('./_lib/albums')(N);
  yield require('./_lib/avatars')(N);
  yield require('./_lib/files')(N);

  process.exit(0);
});
