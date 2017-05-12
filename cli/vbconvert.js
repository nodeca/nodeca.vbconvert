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

  if (args.module) {
    let modules = args.module;

    for (let m of modules) {
      if (module_list.indexOf(m) === -1) throw `Unknown vbconvert module: ${m}`;
    }

    for (let m of modules) {
      await require('./_lib/' + m)(N);
    }
  } else {
    let modules = module_list;

    for (let m of modules) {
      if (await N.redis.sismemberAsync('vbconvert:all', m)) continue;

      await require('./_lib/' + m)(N);

      await N.redis.saddAsync('vbconvert:all', m);
    }

    await N.redis.delAsync('vbconvert:all');
  }

  return N.wire.emit('exit.shutdown');
};
