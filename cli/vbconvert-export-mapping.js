// Export old to new forum id mappings into levelDB
//

'use strict';

const _           = require('lodash');
const batchStream = require('batch-stream');
const level       = require('level');
const mkdirp      = require('mkdirp');
const path        = require('path');
const stream      = require('stream');
const pump        = require('util').promisify(require('pump'));
const progress    = require('./_lib/utils').progress;

const BATCH_SIZE = 10000;


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


module.exports.run = async function (N, args) {
  let total, bar, batch, db_path = args.dest, ldb = {};

  await N.wire.emit('init:models', N);

  mkdirp.sync(args.dest);

  [ 'topics', 'posts', 'avatars', 'albums', 'attachments', 'filedataids',
    'pictureaids', 'blogaids', 'users_by_nick', 'blog_tags', 'blog_entries',
    'blog_comments', 'club_topics', 'club_posts' ].forEach(name => {
      ldb[name] = level(path.join(db_path, name), {
        valueEncoding: 'json'
      });
    });


  //
  // Export topic mappings
  //
  N.logger.info('Exporting topic mappings');

  let topics_by_id = _.keyBy(
    await N.models.forum.Topic.find().select('section hid').lean(true),
    '_id'
  );

  let sections_by_id = _.keyBy(
    await N.models.forum.Section.find().select('_id hid').lean(true),
    '_id'
  );

  batch = ldb.topics.batch();

  Object.keys(topics_by_id).forEach(id => {
    let section_id = topics_by_id[id].section;

    batch.put(topics_by_id[id].hid, { section: sections_by_id[section_id].hid });
  });

  await batch.write();


  //
  // Export post mappings
  //
  N.logger.info('Exporting post mappings');

  total = await N.models.vbconvert.PostMapping.count();
  bar = progress(' posts :current/:total :percent', total);

  await pump(
    N.models.vbconvert.PostMapping.find()
        .select('mysql topic_id post_hid')
        .lean(true)
        .cursor(),

    batchStream({ size: BATCH_SIZE }),

    new stream.Writable({
      objectMode: true,
      highWaterMark: 2, // buffer 2 chunks at most
      write(chunk, __, callback) {
        let batch = ldb.posts.batch();

        for (let post of chunk) {
          batch.put(post.mysql, {
            topic: topics_by_id[post.topic_id].hid,
            post:  post.post_hid
          });
        }

        bar.tick(chunk.length);
        batch.write(callback);
      }
    })
  );

  bar.terminate();


  //
  // Export user avatar ids
  //
  N.logger.info('Exporting user avatar ids');

  let users_by_id = _.keyBy(
    await N.models.users.User.find().select('_id hid avatar_id').lean(true),
    '_id'
  );

  batch = ldb.avatars.batch();

  Object.keys(users_by_id)
    .filter(user_id => users_by_id[user_id].avatar_id)
    .forEach(user_id => {
      batch.put(users_by_id[user_id].hid, { avatar: users_by_id[user_id].avatar_id });
    });

  await batch.write();


  //
  // Export album mappings
  //
  N.logger.info('Exporting album mappings');

  total = await N.models.vbconvert.AlbumMapping.count();
  bar = progress(' albums :current/:total :percent', total);

  await pump(
    N.models.vbconvert.AlbumMapping.aggregate([ {
      $lookup: {
        from: 'users.albums',
        localField: 'mongo',
        foreignField: '_id',
        as: 'album'
      }
    } ]).cursor({ useMongooseAggCursor: true }).exec(),

    batchStream({ size: BATCH_SIZE }),

    new stream.Writable({
      objectMode: true,
      highWaterMark: 2, // buffer 2 chunks at most
      write(chunk, __, callback) {
        let batch = ldb.albums.batch();

        for (let mapping of chunk) {
          let user_hid = users_by_id[mapping.album[0].user].hid;

          batch.put(mapping.mysql, { user: user_hid, album: mapping.mongo });
        }

        bar.tick(chunk.length);
        batch.write(callback);
      }
    })
  );

  bar.terminate();


  //
  // Export file mappings
  //
  N.logger.info('Exporting file mappings');

  total = await N.models.vbconvert.FileMapping.count();
  bar = progress(' files :current/:total :percent', total);

  await pump(
    N.models.vbconvert.FileMapping.aggregate([ {
      $lookup: {
        from: 'users.mediainfos',
        localField: 'media_id',
        foreignField: '_id',
        as: 'media'
      }
    }, {
      $project: {
        attachmentid:      1,
        filedataid:        1,
        pictureaid_legacy: 1,
        blogaid_legacy:    1,
        media_id:          1,
        user:              { $arrayElemAt: [ '$media.user', 0 ] }
      }
    } ]).cursor({ useMongooseAggCursor: true }).exec(),

    batchStream({ size: BATCH_SIZE }),

    new stream.Writable({
      objectMode: true,
      highWaterMark: 2, // buffer 2 chunks at most
      write(chunk, __, callback) {
        let b_filedataids = ldb.filedataids.batch();
        let b_pictureaids = ldb.pictureaids.batch();
        let b_blogaids    = ldb.blogaids.batch();
        let b_attachments = ldb.attachments.batch();

        for (let file of chunk) {
          b_filedataids.put(file.filedataid, { attachment: file.attachmentid });

          if (file.pictureaid_legacy) {
            b_pictureaids.put(file.pictureaid_legacy, { attachment: file.attachmentid });
          }

          if (file.blogaid_legacy) {
            b_blogaids.put(file.blogaid_legacy, { attachment: file.attachmentid });
          }

          let user_hid = users_by_id[file.user].hid;

          b_attachments.put(file.attachmentid, { user: user_hid, media: file.media_id });
        }

        bar.tick(chunk.length);
        Promise.all([
          b_filedataids.write(),
          b_pictureaids.write(),
          b_blogaids.write(),
          b_attachments.write()
        ]).then(() => callback(), err => callback(err));
      }
    })
  );

  bar.terminate();


  //
  // Export user nick -> hid mapping
  //
  N.logger.info('Exporting user mappings');

  total = await N.models.users.User.count();
  bar = progress(' users :current/:total :percent', total);

  await pump(
    N.models.users.User.find()
        .select('hid nick')
        .lean(true)
        .cursor(),

    batchStream({ size: BATCH_SIZE }),

    new stream.Writable({
      objectMode: true,
      highWaterMark: 2, // buffer 2 chunks at most
      write(chunk, __, callback) {
        let batch = ldb.users_by_nick.batch();

        for (let user of chunk) {
          batch.put(user.nick.toLowerCase(), { hid: user.hid });
        }

        bar.tick(chunk.length);
        batch.write(callback);
      }
    })
  );

  bar.terminate();


  //
  // Export blog entry mappings
  //
  N.logger.info('Exporting blog entry mappings');

  let blog_entries_by_id = _.keyBy(
    await N.models.blogs.BlogEntry.find().select('user hid').lean(true),
    '_id'
  );

  batch = ldb.blog_entries.batch();

  Object.keys(blog_entries_by_id).forEach(id => {
    let entry = blog_entries_by_id[id];

    if (!users_by_id[entry.user]) return;

    let user_hid = users_by_id[entry.user].hid;

    batch.put(entry.hid, { user: user_hid });
  });

  await batch.write();


  //
  // Export blog comment mappings
  //
  N.logger.info('Exporting blog comment mappings');

  total = await N.models.vbconvert.BlogTextMapping.count();
  bar = progress(' blog comments :current/:total :percent', total);

  await pump(
    N.models.vbconvert.BlogTextMapping.aggregate([ {
      $lookup: {
        from: 'blogs.blogcomments',
        localField: 'mongo',
        foreignField: '_id',
        as: 'blogcomment'
      }
    } ]).cursor({ useMongooseAggCursor: true }).exec(),

    batchStream({ size: BATCH_SIZE }),

    new stream.Writable({
      objectMode: true,
      highWaterMark: 2, // buffer 2 chunks at most
      write(chunk, __, callback) {
        let batch = ldb.blog_comments.batch();

        for (let mapping of chunk) {
          if (!mapping.blogcomment.length) continue;

          batch.put(mapping.blogtextid, {
            entry: blog_entries_by_id[mapping.blogcomment[0].entry].hid,
            comment: mapping.blogcomment[0].hid
          });
        }

        bar.tick(chunk.length);
        batch.write(callback);
      }
    })
  );

  bar.terminate();


  //
  // Export blog category mappings
  //
  N.logger.info('Exporting blog category mappings');

  total = await N.models.vbconvert.BlogCategoryMapping.count();
  bar = progress(' blog categories :current/:total :percent', total);

  await pump(
    N.models.vbconvert.BlogCategoryMapping.aggregate([ {
      $lookup: {
        from: 'blogs.blogtags',
        localField: 'mongo',
        foreignField: '_id',
        as: 'blogtag'
      }
    } ]).cursor({ useMongooseAggCursor: true }).exec(),

    batchStream({ size: BATCH_SIZE }),

    new stream.Writable({
      objectMode: true,
      highWaterMark: 2, // buffer 2 chunks at most
      write(chunk, __, callback) {
        let batch = ldb.blog_tags.batch();

        for (let mapping of chunk) {
          if (!mapping.blogtag.length) continue;
          if (!users_by_id[mapping.blogtag[0].user]) return;

          batch.put(mapping.mysql, {
            tag:  mapping.blogtag[0].hid,
            user: users_by_id[mapping.blogtag[0].user].hid
          });
        }

        bar.tick(chunk.length);
        batch.write(callback);
      }
    })
  );

  bar.terminate();


  //
  // Export club topic mappings
  //
  N.logger.info('Exporting club topic mappings');

  let club_topics_by_id = _.keyBy(
    await N.models.clubs.Topic.find().select('club hid').lean(true),
    '_id'
  );

  let clubs_by_id = _.keyBy(
    await N.models.clubs.Club.find().select('_id hid').lean(true),
    '_id'
  );

  batch = ldb.club_topics.batch();

  Object.keys(club_topics_by_id).forEach(id => {
    let club_id = club_topics_by_id[id].club;

    batch.put(club_topics_by_id[id].hid, { club: clubs_by_id[club_id].hid });
  });

  await batch.write();


  //
  // Export post mappings
  //
  N.logger.info('Exporting club post mappings');

  total = await N.models.vbconvert.ClubPostMapping.count();
  bar = progress(' club posts :current/:total :percent', total);

  await pump(
    N.models.vbconvert.ClubPostMapping.find()
        .select('mysql topic_id post_hid')
        .lean(true)
        .cursor(),

    batchStream({ size: BATCH_SIZE }),

    new stream.Writable({
      objectMode: true,
      highWaterMark: 2, // buffer 2 chunks at most
      write(chunk, __, callback) {
        let batch = ldb.club_posts.batch();

        for (let post of chunk) {
          batch.put(post.mysql, {
            topic: club_topics_by_id[post.topic_id].hid,
            post:  post.post_hid
          });
        }

        bar.tick(chunk.length);
        batch.write(callback);
      }
    })
  );

  bar.terminate();


  await Promise.all(Object.keys(ldb).map(name => ldb[name].close()));

  N.logger.info('Export finished');

  await N.wire.emit('exit.shutdown');
};
