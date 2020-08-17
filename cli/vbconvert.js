// Convert forum database from vBulletin to Nodeca
//

'use strict';


////////////////////////////////////////////////////////////////////////////////


module.exports.parserParameters  = {
  add_help:     true,
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
  'ignore',
  'sections',
  'custom',
  'nntp',
  'topics',
  'deletion_log',
  'infractions',
  'section_cache',
  'blog_entries',
  'blog_comments',
  'blog_subscriptions',
  'clubs',
  'club_avatars',
  'club_topics',
  'subscriptions',
  'votes',
  'post_vote_recount',
  'albums',
  'avatars',
  'files',
  'moderator_notes' // uses bbcode convertor, which needs link mappings
];


module.exports.run = async function (N, args) {
  await N.wire.emit('init:models', N);

  // load N.router, it's needed to convert bbcode to markdown
  await N.wire.emit('init:bundle', N);

  if (args.module) {
    let modules = args.module;

    for (let m of modules) {
      if (module_list.indexOf(m) === -1) {
        throw 'Unknown vbconvert module: ' + m + '\n' +
              'Available modules are: ' + module_list.join(', ');
      }
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
