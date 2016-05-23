// Export old to new forum id mappings into levelDB
//

'use strict';

const _           = require('lodash');
const co          = require('bluebird-co').co;
const level       = require('level');
const mkdirp      = require('mkdirp');
const path        = require('path');
const pump        = require('pump');
const through2    = require('through2');
const progress    = require('./_lib/utils').progress;


////////////////////////////////////////////////////////////////////////////////


module.exports.parserParameters  = {
  addHelp:      true,
  help:         'export mappings into levelDB',
  description:  'Export old to new forum id mappings into levelDB'
};


module.exports.commandLineArguments = [
  {
    args: [ '-d', '--dest' ],
    options: {
      help:     'Database path',
      type:     'string',
      required: true
    }
  }
];


module.exports.run = co.wrap(function* (N, args) {
  let total, bar, ldb = {};

  yield N.wire.emit('init:models', N);

  mkdirp.sync(args.dest);

  //
  // Export topic mappings
  //
  N.logger.info('Loading topics into memory');

  [ 'topics', 'posts', 'avatars', 'albums', 'attachments', 'filedataids', 'pictureaids', 'blogaids' ].forEach(name => {
    ldb[name] = level(path.join(args.dest, name), {
      valueEncoding: 'json'
    });
  });

  let all_topics    = yield N.models.forum.Topic.find().select('section hid').lean(true);
  let topics_by_hid = _.keyBy(all_topics, 'hid');
  let topics_by_id  = _.keyBy(all_topics, '_id');

  let sections_by_id = _.keyBy(
    yield N.models.forum.Section.find().select('_id hid').lean(true),
    '_id'
  );

  let batch = ldb.topics.batch();

  Object.keys(topics_by_hid).forEach(topic_hid => {
    let section_id = topics_by_hid[topic_hid].section;

    batch.put(topic_hid, { section: sections_by_id[section_id].hid });
  });

  N.logger.info('Exporting topic mappings');

  batch.write();

  //
  // Export post mappings
  //
  N.logger.info('Exporting post mappings');

  total = yield N.models.vbconvert.PostMapping.count();
  bar = progress(' posts :current/:total [:bar] :percent', total);

  yield new Promise((resolve, reject) => {
    pump(
      N.models.vbconvert.PostMapping.collection.find({}, {
        mysql:    1,
        topic_id: 1,
        post_hid: 1
      }).stream(),

      through2.obj((post, enc, callback) => {
        bar.tick();

        ldb.posts.put(post.mysql, {
          topic: topics_by_id[post.topic_id].hid,
          post:  post.post_hid
        });

        callback();
      }),

      err => {
        if (err) reject(err);
        else resolve();
      }
    );
  });

  bar.terminate();

  //
  // Export user avatar ids
  //
  N.logger.info('Exporting user avatar ids');

  let users_by_id = _.keyBy(
    yield N.models.users.User.find().select('_id hid avatar_id').lean(true),
    '_id'
  );

  batch = ldb.avatars.batch();

  Object.keys(users_by_id)
    .filter(user_id => users_by_id[user_id].avatar_id)
    .forEach(user_id => {
      batch.put(users_by_id[user_id].hid, { avatar: users_by_id[user_id].avatar_id });
    });

  batch.write();

  //
  // Export album mappings
  //
  N.logger.info('Exporting album mappings');

  total = yield N.models.vbconvert.AlbumMapping.count();
  bar = progress(' albums :current/:total [:bar] :percent', total);

  yield new Promise((resolve, reject) => {
    pump(
      N.models.vbconvert.AlbumMapping.collection.find({}).stream(),

      through2.obj((albummap, enc, callback) => {
        N.models.users.Album.findById(albummap.mongo)
            .select('user')
            .lean(true)
            .exec(function (err, album) {

          if (err) {
            callback(err);
            return;
          }

          bar.tick();

          let user_hid = users_by_id[album.user].hid;

          ldb.albums.put(albummap.mysql, { user: user_hid, album: albummap.mongo });
          callback();
        });
      }),

      err => {
        if (err) reject(err);
        else resolve();
      }
    );
  });

  bar.terminate();

  //
  // Export file mappings
  //
  N.logger.info('Exporting file mappings');

  total = yield N.models.vbconvert.FileMapping.count();
  bar = progress(' files :current/:total [:bar] :percent', total);

  yield new Promise((resolve, reject) => {
    pump(
      N.models.vbconvert.FileMapping.collection.aggregate([ {
        $lookup: {
          from: 'users.mediainfos',
          localField: 'media_id',
          foreignField: '_id',
          as: 'media'
        }
      } ]).stream(),

      through2.obj((file, enc, callback) => {
        bar.tick();

        ldb.filedataids.put(file.filedataid, { attachment: file.attachmentid });

        if (file.pictureaid_legacy) {
          ldb.pictureaids.put(file.pictureaid_legacy, { attachment: file.attachmentid });
        }

        if (file.blogaid_legacy) {
          ldb.blogaids.put(file.blogaid_legacy, { attachment: file.attachmentid });
        }

        let user_hid = users_by_id[file.media[0].user_id].hid;

        ldb.attachments.put(file.attachmentid, { user: user_hid, media: file.media_id });
        callback();
      }),

      err => {
        if (err) reject(err);
        else resolve();
      }
    );
  });

  bar.terminate();

  yield Object.keys(ldb).map(name => new Promise((resolve, reject) => {
    ldb[name].close(err => {
      if (err) reject(err);
      else resolve();
    });
  }));

  N.logger.info('Export finished');

  process.exit(0);
});
