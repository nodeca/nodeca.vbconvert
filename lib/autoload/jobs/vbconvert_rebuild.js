// Convert bbcode to markdown and rebuild post
//
'use strict';


var async      = require('async');
var bb_to_md   = require('nodeca.vbconvert/lib/bbcode').bbcode_to_markdown;

// amount of posts in a chunk
var BLOCK_SIZE = 1000;


module.exports = function (N) {

  N.wire.on('init:jobs', function register_vbconvert_rebuild() {
    N.queue.registerWorker({
      name: 'vbconvert_rebuild',

      // static id to make sure it will never be executed twice at the same time
      taskID: function () {
        return 'vbconvert_rebuild';
      },

      chunksPerInstance: 1,

      map: function (callback) {
        N.models.vbconvert.PostMapping
            .find()
            .select('mysql_id')
            .sort({ mysql_id: -1 })
            .limit(1)
            .lean(true)
            .exec(function (err, posts) {

          if (err) {
            callback(err);
            return;
          }

          var chunks = [];

          for (var i = 0; i < posts[0].mysql_id; i += BLOCK_SIZE) {
            chunks.push([ i, i + BLOCK_SIZE - 1 ]);
          }

          callback(null, chunks);
        });
      },

      process: function (callback) {
        N.models.vbconvert.PostMapping
            .where('mysql_id').gte(this.data[0])
            .where('mysql_id').lte(this.data[1])
            .lean(true)
            .exec(function (err, postmappings) {

          if (err) {
            callback(err);
            return;
          }

          async.eachLimit(postmappings, 20, function (postmapping, callback) {
            N.models.forum.Post.update(
                { _id: postmapping.post_id },
                { $set: { md: bb_to_md(postmapping.text) } },
                function (err) {

              if (err) {
                callback(err);
                return;
              }

              N.wire.emit('internal:forum.post_rebuild', postmapping.post_id, callback);
            });
          }, callback);
        });
      },

      reduce: function (__, callback) {
        callback();
      }
    });
  });
};
