// Convert forum database from vBulletin to Nodeca
//

'use strict';

const co = require('bluebird-co').co;


////////////////////////////////////////////////////////////////////////////////


module.exports.parserParameters  = {
  addHelp:      true,
  help:         'import data from vBulletin',
  description:  'Import data from vBulletin'
};


module.exports.commandLineArguments = [
];


module.exports.run = co.wrap(function* (N/*, args*/) {
  yield N.wire.emit('init:models', N);

  // load N.router, it's needed to convert bbcode to markdown
  yield N.wire.emit('init:bundle', N);

  yield require('./_lib/usergroups')(N);
  yield require('./_lib/users')(N);
  yield require('./_lib/pm')(N);
  yield require('./_lib/usernotes')(N);
  yield require('./_lib/moderator_notes')(N);
  yield require('./_lib/ignore')(N);
  yield require('./_lib/sections')(N);
  yield require('./_lib/topics')(N);
  yield require('./_lib/deletion_log')(N);
  yield require('./_lib/infractions')(N);
  yield require('./_lib/section_cache')(N);
  yield require('./_lib/subscriptions')(N);
  yield require('./_lib/votes')(N);
  yield require('./_lib/albums')(N);
  yield require('./_lib/avatars')(N);
  yield require('./_lib/files')(N);

  process.exit(0);
});
