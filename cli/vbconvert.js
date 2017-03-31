// Convert forum database from vBulletin to Nodeca
//

'use strict';


////////////////////////////////////////////////////////////////////////////////


module.exports.parserParameters  = {
  addHelp:      true,
  help:         'import data from vBulletin',
  description:  'Import data from vBulletin'
};


module.exports.commandLineArguments = [
  {
    args:     [ '-m', '--module' ],
    options: {
      dest:   'module',
      help:   'Run specified import scripts only (for debugging)',
      type:   'string',
      action: 'append'
    }
  }
];


// List of modules (from _lib/*.js) to run
const module_list = [
  'usergroups',
  'users',
  'pm',
  'usernotes',
  'moderator_notes',
  'ignore',
  'sections',
  'nntp',
  'topics',
  'deletion_log',
  'infractions',
  'section_cache',
  'subscriptions',
  'votes',
  'albums',
  'avatars',
  'files',
  'custom'
];


module.exports.run = async function (N, args) {
  await N.wire.emit('init:models', N);

  // load N.router, it's needed to convert bbcode to markdown
  await N.wire.emit('init:bundle', N);

  let modules = module_list;

  if (args.module) {
    modules = args.module;

    for (let m of modules) {
      if (module_list.indexOf(m) === -1) throw `Unknown vbconvert module: ${m}`;
    }
  }

  for (let m of modules) await require('./_lib/' + m)(N);

  return N.wire.emit('exit.shutdown');
};
