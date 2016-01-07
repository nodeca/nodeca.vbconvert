
'use strict';

var URL = require('url');
var pathRegexp = require('path-to-regexp');


module.exports = function (N) {
  var parsedUrl, linkDefaults, compiled = [];

  if (N.config.vbconvert.destination) {
    parsedUrl = URL.parse(N.config.vbconvert.destination, null, true);
    linkDefaults = {
      protocol: parsedUrl.protocol ? parsedUrl.protocol.replace(/:$/, '') : null,
      hostname: parsedUrl.host
    };
  }


  function link_to_index(N, params, callback) {
    callback(null, N.router.linkTo('forum.index', {}, linkDefaults));
  }


  function link_to_forum(N, params, callback) {
    callback(null, N.router.linkTo('forum.section', { hid: params.forum }, linkDefaults));
  }


  function link_to_thread(N, params, callback) {
    N.models.forum.Topic
        .findOne({ hid: params.thread })
        .select('hid section')
        .lean(true)
        .exec(function (err, topic) {

      if (err) {
        callback(err);
        return;
      }

      if (!topic) {
        callback();
        return;
      }

      N.models.forum.Section
          .findById(topic.section)
          .select('hid')
          .lean(true)
          .exec(function (err, section) {

        if (err) {
          callback(err);
          return;
        }

        if (!section) {
          callback();
          return;
        }

        callback(null, N.router.linkTo('forum.topic', {
          section_hid: section.hid,
          topic_hid:   topic.hid,
          page:        params.page
        }, linkDefaults));
      });
    });
  }

  function link_to_post(N, params, callback) {
    N.models.vbconvert.PostMapping
        .findOne({ mysql_id: params.post })
        .lean(true)
        .exec(function (err, post_mapping) {

      if (err) {
        callback(err);
        return;
      }

      if (!post_mapping) {
        callback();
        return;
      }

      N.models.forum.Topic
          .findById(post_mapping.topic_id)
          .select('hid section')
          .lean(true)
          .exec(function (err, topic) {

        if (err) {
          callback(err);
          return;
        }

        if (!topic) {
          callback();
          return;
        }

        N.models.forum.Section
            .findById(topic.section)
            .select('hid')
            .lean(true)
            .exec(function (err, section) {

          if (err) {
            callback(err);
            return;
          }

          if (!section) {
            callback();
            return;
          }

          callback(null, N.router.linkTo('forum.topic', {
            section_hid: section.hid,
            topic_hid:   topic.hid,
            post_hid:    post_mapping.post_hid
          }, linkDefaults));
        });
      });
    });
  }

  function link_to_attach(N, params, callback) {
    N.models.vbconvert.FileMapping
        .findOne({ mysql: params.attach })
        .lean(true)
        .exec(function (err, file_mapping) {

      if (err) {
        callback(err);
        return;
      }

      if (!file_mapping) {
        callback();
        return;
      }

      N.models.users.MediaInfo
          .findById(file_mapping.mongo)
          .select('user_id media_id')
          .lean(true)
          .exec(function (err, mediainfo) {

        if (err) {
          callback(err);
          return;
        }

        if (!mediainfo) {
          callback();
          return;
        }

        N.models.users.User
            .findById(mediainfo.user_id)
            .select('hid')
            .lean(true)
            .exec(function (err, user) {

          if (err) {
            callback(err);
            return;
          }

          if (!user) {
            callback();
            return;
          }

          callback(null, N.router.linkTo('users.media', {
            user_hid: user.hid,
            media_id: mediainfo.media_id
          }, linkDefaults));
        });
      });
    });
  }

  function link_to_attach_raw(N, params, callback) {
    N.models.vbconvert.FileMapping
        .findOne({ mysql: params.attach })
        .lean(true)
        .exec(function (err, file_mapping) {

      if (err) {
        callback(err);
        return;
      }

      if (!file_mapping) {
        callback();
        return;
      }

      N.models.users.MediaInfo
          .findById(file_mapping.mongo)
          .select('user_id media_id')
          .lean(true)
          .exec(function (err, mediainfo) {

        if (err) {
          callback(err);
          return;
        }

        if (!mediainfo) {
          callback();
          return;
        }

        callback(null, N.router.linkTo('core.gridfs', {
          bucket: mediainfo.media_id + (params.isthumb ? '_sm' : '')
        }, linkDefaults));
      });
    });
  }

  function link_to_album(N, params, callback) {
    N.models.vbconvert.AlbumMapping
        .findOne({ mysql: params.album })
        .lean(true)
        .exec(function (err, album_mapping) {

      if (err) {
        callback(err);
        return;
      }

      if (!album_mapping) {
        callback();
        return;
      }

      N.models.users.Album
          .findById(album_mapping.mongo)
          .select('user_id')
          .lean(true)
          .exec(function (err, album) {

        if (err) {
          callback(err);
          return;
        }

        if (!album) {
          callback();
          return;
        }

        N.models.users.User
            .findById(album.user_id)
            .select('hid')
            .lean(true)
            .exec(function (err, user) {

          if (err) {
            callback(err);
            return;
          }

          if (!user) {
            callback();
            return;
          }

          callback(null, N.router.linkTo('users.album', {
            user_hid: user.hid,
            album_id: album._id
          }, linkDefaults));
        });
      });
    });
  }

  function link_to_user(N, params, callback) {
    N.models.users.User
        .findOne({ hid: params.user })
        .select('hid')
        .lean(true)
        .exec(function (err, user) {

      if (err) {
        callback(err);
        return;
      }

      if (!user) {
        callback();
        return;
      }

      callback(null, N.router.linkTo('users.member', {
        user_hid: user.hid,
      }, linkDefaults));
    });
  }


  // The list of rules and functions to execute if they match
  //
  var rules = {
    '/f:forum/thread:thread.html#post:post':               link_to_post,
    '/f:forum/thread:thread-:page.html#post:post':         link_to_post,
    '/f:forum/thread:thread.html#entry:post':              link_to_post,
    '/f:forum/thread:thread-:page.html#entry:post':        link_to_post,
    '/f:forum/thread:thread-post:post.html':               link_to_post,
    '/index.php?act=findpost&p=:post':                     link_to_post,
    '/index.php?act=findpost&pid=:post':                   link_to_post,
    '/index.php?showtopic=:thread&p=:post':                link_to_post,
    '/index.php?showtopic=:thread&pid=:post':              link_to_post,
    '/index.php?showtopic=:thread&gopid=:post':            link_to_post,
    '/index.php?act=ST&f=:forum&t=:thread#entry:post':     link_to_post,
    '/index.php?act=ST&view=findpost&p=:post':             link_to_post,
    '/showthread.php?t=:thread#post:post':                 link_to_post,
    '/showthread.php?t=:thread#entry:post':                link_to_post,
    '/showthread.php?p=:post':                             link_to_post,
    '/showpost.php?p=:post':                               link_to_post,
    '/f:forum/thread:thread.html':                         link_to_thread,
    '/f:forum/thread:thread-:page.html':                   link_to_thread,
    '/index.php?showtopic=:thread':                        link_to_thread,
    '/index.php?act=ST&f=:forum&t=:thread':                link_to_thread,
    '/index.php?act=Print&f=:forum&t=:thread':             link_to_thread,
    '/showthread.php?t=:thread&page=:page':                link_to_thread,
    '/showthread.php?t=:thread':                           link_to_thread,
    '/lofiversion/index.php/t:thread-:page.html':          link_to_thread,
    '/lofiversion/index.php/t:thread.html':                link_to_thread,
    '/lofiversion/index.php?t:thread-:page.html':          link_to_thread,
    '/lofiversion/index.php?t:thread.html':                link_to_thread,
    '/f:forum':                                            link_to_forum,
    '/index.php?showforum=:forum':                         link_to_forum,
    '/index.php?act=SF&f=:forum':                          link_to_forum,
    '/lofiversion/index.php/f:forum.html':                 link_to_forum,
    '/lofiversion/index.php?f:forum.html':                 link_to_forum,
    '/index.php?showuser=:user':                           link_to_user,
    '/member.php?u=:user':                                 link_to_user,
    '/attachment.php?attachmentid=:attach&thumb=:isthumb': link_to_attach_raw,
    '/attachment.php?attachmentid=:attach':                link_to_attach_raw,
    '/index.php?act=Attach&id=:attach':                    link_to_attach_raw,
    '/index.php?act=attach&id=:attach':                    link_to_attach_raw,
    '/album.php?albumid=:album&attachmentid=:attach':      link_to_attach,
    '/album.php?albumid=:album&page=:page':                link_to_album,
    '/album.php?albumid=:album':                           link_to_album,
    '/index.php?op=view_album&album=:album':               link_to_album,
    '/lofiversion/index.php':                              link_to_index,
    '/index.php':                                          link_to_index,
    '/':                                                   link_to_index
  };


  Object.keys(rules).forEach(function (pattern) {
    var parsed = URL.parse(pattern, true);
    var rule = { fn: rules[pattern] };

    rule._path = pathRegexp(parsed.pathname, rule._path_args = []);

    if (parsed.query) {
      var keys = Object.keys(parsed.query);

      if (keys.length === 1 && parsed.query[keys[0]] === '') {
        // query is like `?t:topic.html`, not key-value
        rule._search = pathRegexp(parsed.search.slice(1), rule._search_args = [], { strict: true });
      } else {
        rule._query = {};
        rule._query_args = {};

        Object.keys(parsed.query).forEach(function (k) {
          rule._query[k] = pathRegexp(parsed.query[k], rule._query_args[k] = [], { strict: true });
        });
      }
    }

    if (parsed.hash) {
      rule._hash = pathRegexp(parsed.hash, rule._hash_args = [], { strict: true });
    }

    compiled.push(rule);
  });

  return function link_rewrite(urlStr, callback) {
    var url = URL.parse(urlStr, true, true);

    if (url.hostname !== 'forum.rcdesign.ru') {
      callback(null, urlStr);
      return;
    }

    var matches = [];

    compiled.forEach(function (rule) {
      var params = {}, m, i;

      // Check pathname
      //
      m = rule._path.exec(url.pathname);

      if (!m) { return; }

      rule._path_args.forEach(function (arg, i) {
        params[arg.name] = m[i + 1];
      });

      // Check query
      //
      if (rule._search) {
        m = rule._search.exec(url.search.slice(1));

        if (!m) { return; }

        rule._search_args.forEach(function (arg, i) {
          params[arg.name] = m[i + 1];
        });
      } else if (rule._query) {
        var keys = Object.keys(rule._query);

        for (i = 0; i < keys.length; i++) {
          var k = keys[i];

          m = rule._query[k].exec(url.query[k] || '');

          if (!m) { return; }

          /* eslint-disable no-loop-func */
          rule._query_args[k].forEach(function (arg, i) {
            params[arg.name] = m[i + 1];
          });
        }
      }

      // Check hash
      //
      if (rule._hash) {
        m = rule._hash.exec(url.hash);

        if (!m) { return; }

        rule._hash_args.forEach(function (arg, i) {
          params[arg.name] = m[i + 1];
        });
      }

      // Check that all arguments are numbers and cast them
      //
      var valid = true;

      Object.keys(params).forEach(function (k) {
        if (!params[k].match(/^\d+$/)) {
          valid = false;
          return;
        }

        params[k] = Number(params[k]);
      });

      if (valid) {
        matches.push({ fn: rule.fn, params: params });
      }
    });

    // Sequentially execute all matched rules until one of them returns url
    //
    (function run_matches(matches) {
      if (matches.length === 0) {
        callback(null, urlStr);
        return;
      }

      var m = matches.shift();

      m.fn(N, m.params, function (err, url) {
        if (err) {
          callback(err);
          return;
        }

        if (url) {
          callback(null, url);
          return;
        }

        run_matches(matches);
      });
    })(matches);
  };
};
