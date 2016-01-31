
'use strict';

var URL = require('url');
var pathRegexp = require('path-to-regexp');

// amount of posts per page on the old forum
var POSTS_PER_PAGE = 40;

// cyrillic transliteration table
var transliterate_table = {
  а: 'a',   б: 'b',    в: 'v',  г: 'g',  д: 'd',  е: 'e',
  ж: 'zh',  з: 'z',    и: 'i',  й: 'j',  к: 'k',  л: 'l',
  м: 'm',   н: 'n',    о: 'o',  п: 'p',  р: 'r',  с: 's',
  т: 't',   у: 'u',    ф: 'f',  х: 'h',  ц: 'c',  ч: 'ch',
  ш: 'sh',  щ: 'sch',  ъ: "'",  ы: 'y',  ь: "'",  э: 'e',
  ю: 'yu',  я: 'ya',   ё: 'yo' };

var transliterate_reg = new RegExp(Object.keys(transliterate_table).join('|'), 'g');

function slugify(text) {
  return text.toLowerCase()
             .replace(transliterate_reg, function (k) {
                return transliterate_table[k];
              })
             .replace(/[^\w]+/g, '-');
}


module.exports = function (N) {
  var parsedUrl, linkDefaults, compiled = [];

  if (N.config.vbconvert.destination) {
    parsedUrl = URL.parse(N.config.vbconvert.destination, null, true);
    linkDefaults = {
      protocol: parsedUrl.protocol ? parsedUrl.protocol.replace(/:$/, '') : null,
      hostname: parsedUrl.host
    };
  }


  // Links to index page
  //
  function link_to_index(N, urlStr, params, callback) {
    callback(null, N.router.linkTo('forum.index', {}, linkDefaults));
  }


  // Links to forum section
  //
  function link_to_forum(N, urlStr, params, callback) {
    callback(null, N.router.linkTo('forum.section', { hid: params.forum }, linkDefaults));
  }


  // Links to category
  //
  function link_to_category(N, urlStr, params, callback) {
    N.models.forum.Section
        .find({ parent: { $exists: false } })
        .select('hid title')
        .lean(true)
        .exec(function (err, sections) {

      if (err) {
        callback(err);
        return;
      }

      var hash = '#' + params.slug;

      sections.forEach(function (section) {
        if (slugify(section.title) === params.slug) {
          hash = '#cat' + section.hid;
        }
      });

      callback(null, N.router.linkTo('forum.index', {}, linkDefaults) + hash);
    });
  }


  // Links to forum topic
  //
  function link_to_thread(N, urlStr, params, callback) {
    var post_hid;

    if (params.start) {
      post_hid = params.start;
    } else if (params.st) {
      post_hid = params.st;
    } else if (params.page) {
      post_hid = (params.page - 1) * POSTS_PER_PAGE + 1;
    }

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
        callback(null, N.router.linkTo('forum.topic', {
          section_hid: params.forum || 1,
          topic_hid:   params.thread,
          post_hid
        }, linkDefaults));
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
          callback(null, N.router.linkTo('forum.topic', {
            section_hid: params.forum || 1,
            topic_hid:   params.thread,
            post_hid
          }, linkDefaults));
          return;
        }

        callback(null, N.router.linkTo('forum.topic', {
          section_hid: section.hid,
          topic_hid:   topic.hid,
          post_hid
        }, linkDefaults));
      });
    });
  }


  // Links to forum post
  //
  function link_to_post(N, urlStr, params, callback) {
    N.models.vbconvert.PostMapping
        .findOne({ mysql_id: params.post })
        .lean(true)
        .exec(function (err, post_mapping) {

      if (err) {
        callback(err);
        return;
      }

      if (!post_mapping) {
        link_to_thread(N, urlStr, params, callback);
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
          link_to_thread(N, urlStr, params, callback);
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
            link_to_thread(N, urlStr, params, callback);
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


  // Links to attachment
  //
  function link_to_attach(N, urlStr, params, callback) {
    N.models.vbconvert.FileMapping
        .findOne({ attachmentid: params.attach })
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
          .findById(file_mapping.media_id)
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


  // Links to attachment image
  //
  function link_to_attach_raw(N, urlStr, params, callback) {
    N.models.vbconvert.FileMapping
        .findOne({ attachmentid: params.attach })
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
          .findById(file_mapping.media_id)
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


  // Links to attachment image by filedataid
  //
  function link_to_attach_filedata(N, urlStr, params, callback) {
    N.models.vbconvert.FileMapping
        .findOne({ filedataid: params.filedataid })
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
          .findById(file_mapping.media_id)
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

        // those are always .thumb
        callback(null, N.router.linkTo('core.gridfs', {
          bucket: mediainfo.media_id + '_sm'
        }, linkDefaults));
      });
    });
  }


  // Links to attachment image by pictureid
  //
  function link_to_attach_picture(N, urlStr, params, callback) {
    N.models.vbconvert.FileMapping
        .findOne({ pictureaid_legacy: params.p_aid })
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
          .findById(file_mapping.media_id)
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
          bucket: mediainfo.media_id
        }, linkDefaults));
      });
    });
  }


  // Links to attachment image by blogattachmentid
  //
  function link_to_attach_blogentry(N, urlStr, params, callback) {
    N.models.vbconvert.FileMapping
        .findOne({ blogaid_legacy: params.b_aid })
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
          .findById(file_mapping.media_id)
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
          bucket: mediainfo.media_id
        }, linkDefaults));
      });
    });
  }


  // Links to album
  //
  function link_to_album(N, urlStr, params, callback) {
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


  // Links to user profile
  //
  function link_to_user(N, urlStr, params, callback) {
    callback(null, N.router.linkTo('users.member', {
      user_hid: params.user
    }, linkDefaults));
  }


  // Links to user avatar
  //
  function link_to_avatar(size) {
    return function (N, urlStr, params, callback) {
      N.models.users.User
          .findOne({ hid: params.user })
          .select('avatar_id')
          .lean(true)
          .exec(function (err, user) {

        if (err) {
          callback(err);
          return;
        }

        if (!user || !user.avatar_id) {
          callback();
          return;
        }

        callback(null, N.router.linkTo('core.gridfs', {
          bucket: user.avatar_id + (size && size !== 'orig' ? '_' + size : '')
        }, linkDefaults));
      });
    };
  }


  function do_not_convert(N, urlStr, params, callback) {
    callback(null, urlStr);
  }


  // The list of rules and functions to execute if they match
  //
  var rules = {
    //
    // Current forum
    //

    // forum posts
    '/f:forum/thread:thread.html#post:post':               link_to_post,
    '/f:forum/thread:thread-:page.html#post:post':         link_to_post,
    '/f:forum/thread:thread-post:post.html':               link_to_post,
    '/showthread.php?t=:thread#post:post':                 link_to_post,
    '/showthread.php?p=:post':                             link_to_post,
    '/showpost.php?p=:post':                               link_to_post,

    // forum topics
    '/f:forum/thread:thread.html':                         link_to_thread,
    '/f:forum/thread:thread-:page.html':                   link_to_thread,
    '/showthread.php?t=:thread&page=:page':                link_to_thread,
    '/showthread.php?t=:thread':                           link_to_thread,

    // forum sections
    '/f:forum':                                            link_to_forum,
    '/#:slug(.+)':                                         link_to_category,

    // users
    '/member.php?u=:user':                                 link_to_user,

    // albums
    '/attachment.php?attachmentid=:attach&thumb=:isthumb': link_to_attach_raw,
    '/attachment.php?attachmentid=:attach':                link_to_attach_raw,
    '/album.php?albumid=:album&attachmentid=:attach':      link_to_attach,
    '/album.php?albumid=:album&page=:page':                link_to_album,
    '/album.php?albumid=:album':                           link_to_album,
    '/uploads/posts/([0-9]+)+/:filedataid.thumb':          link_to_attach_filedata,
    '/blog_attachment.php?attachmentid=:b_aid':            link_to_attach_blogentry,
    '/picture.php?albumid=:album&pictureid=:p_aid':        link_to_attach_picture,

    // avatars
    // note: `:u(_)` captures underscore, because underscore in :user_:ver
    // is interpreted as part if identifier (i.e. ':user_' + ':ver')
    '/customavatars/avatar:user:u(_):ver.gif':             link_to_avatar('md'),
    '/customavatars/thumbs/avatar:user:u(_):ver.gif':      link_to_avatar('md'),
    '/customprofilepics/profilepic:user:u(_):ver.gif':     link_to_avatar('orig'),

    //
    // New links with old style anchors (posts only)
    //
    '/f:forum/thread:thread.html#entry:post':              link_to_post,
    '/f:forum/thread:thread-:page.html#entry:post':        link_to_post,
    '/showthread.php?t=:thread#entry:post':                link_to_post,

    //
    // Rules from previous versions (ipb_rewrite.php)
    //

    // forum posts
    '/?act=findpost&pid=:post':                            link_to_post,
    '/index.php?act=findpost&p=:post':                     link_to_post,
    '/index.php?act=findpost&pid=:post':                   link_to_post,
    '/index.php?showtopic=:thread&p=:post':                link_to_post,
    '/index.php?showtopic=:thread&pid=:post':              link_to_post,
    '/index.php?showtopic=:thread&gopid=:post':            link_to_post,
    '/index.php?act=ST&f=:forum&t=:thread#entry:post':     link_to_post,
    '/index.php?act=ST&view=findpost&p=:post':             link_to_post,

    // forum topics
    '/index.php?showtopic=:thread&start=:start':           link_to_thread,
    '/index.php?showtopic=:thread&st=:start':              link_to_thread,
    '/index.php?showtopic=:thread':                        link_to_thread,
    '/index.php?act=ST&f=:forum&t=:thread&st=:start':      link_to_thread,
    '/index.php?act=ST&f=:forum&t=:thread':                link_to_thread,
    '/index.php?act=Print&f=:forum&t=:thread':             link_to_thread,

    // forum sections
    '/index.php?showforum=:forum':                         link_to_forum,
    '/index.php?act=SF&f=:forum':                          link_to_forum,

    // users
    '/index.php?showuser=:user':                           link_to_user,

    // albums
    '/index.php?act=([Aa])ttach&type=blogentry&id=:b_aid': link_to_attach_blogentry,
    '/index.php?act=([Aa])ttach&id=:attach':               link_to_attach_raw,
    '/index.php?op=view_album&album=:album':               link_to_album,

    //
    // LoFi version (text)
    //

    // forum topics
    '/lofiversion/index.php/t:thread-:page.html':          link_to_thread,
    '/lofiversion/index.php/t:thread.html':                link_to_thread,
    '/lofiversion/index.php?t:thread-:page.html':          link_to_thread,
    '/lofiversion/index.php?t:thread.html':                link_to_thread,

    // forum sections
    '/lofiversion/index.php/f:forum.html':                 link_to_forum,
    '/lofiversion/index.php?f:forum.html':                 link_to_forum,

    // main page
    '/lofiversion/index.php':                              link_to_index,

    //
    // Default rules
    //
    // Skip links with known arguments and convert the rest to the index page
    //
    '/index.php?act=:anything(.+)':                        do_not_convert,
    '/index.php?autocom=:anything(.+)':                    do_not_convert,
    '/index.php?automodule=:anything(.+)':                 do_not_convert,
    '/index.php':                                          link_to_index
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


  // default pattern in path-to-regexp module
  var DEFAULT_PATTERN = (function () {
    var t = [];

    pathRegexp(':foo', t);

    return t[0].pattern;
  })();


  return function link_rewrite(urlStr, callback) {
    var url = URL.parse(urlStr, true, true);

    if (url.hostname !== 'forum.rcdesign.ru') {
      callback(null, urlStr);
      return;
    }

    var matches = [];

    compiled.forEach(function (rule) {
      var params = {}, m, i;
      var valid = true;

      // Check pathname
      //
      m = rule._path.exec(url.pathname);

      if (!m) return;

      rule._path_args.forEach(function (arg, i) {
        if (arg.pattern === DEFAULT_PATTERN && m[i + 1].match(/^\d+$/)) {
          // pattern is overridden, treat it as a number
          params[arg.name] = Number(m[i + 1]);
        } else if (arg.pattern !== DEFAULT_PATTERN) {
          // pattern is default one, so leave it as a string
          params[arg.name] = m[i + 1];
        } else {
          valid = false;
        }
      });

      // Check query
      //
      if (rule._search) {
        m = rule._search.exec(url.search.slice(1));

        if (!m) return;

        rule._search_args.forEach(function (arg, i) {
          if (arg.pattern === DEFAULT_PATTERN && m[i + 1].match(/^\d+$/)) {
            // pattern is overridden, treat it as a number
            params[arg.name] = Number(m[i + 1]);
          } else if (arg.pattern !== DEFAULT_PATTERN) {
            // pattern is default one, so leave it as a string
            params[arg.name] = m[i + 1];
          } else {
            valid = false;
          }
        });
      } else if (rule._query) {
        var keys = Object.keys(rule._query);

        for (i = 0; i < keys.length; i++) {
          var k = keys[i];

          m = rule._query[k].exec(url.query[k] || '');

          if (!m) return;

          /* eslint-disable no-loop-func */
          rule._query_args[k].forEach(function (arg, i) {
            if (arg.pattern === DEFAULT_PATTERN && m[i + 1].match(/^\d+$/)) {
              // pattern is overridden, treat it as a number
              params[arg.name] = Number(m[i + 1]);
            } else if (arg.pattern !== DEFAULT_PATTERN) {
              // pattern is default one, so leave it as a string
              params[arg.name] = m[i + 1];
            } else {
              valid = false;
            }
          });
        }
      }

      // Check hash
      //
      if (rule._hash) {
        m = rule._hash.exec(url.hash);

        if (!m) return;

        rule._hash_args.forEach(function (arg, i) {
          if (arg.pattern === DEFAULT_PATTERN && m[i + 1].match(/^\d+$/)) {
            // pattern is overridden, treat it as a number
            params[arg.name] = Number(m[i + 1]);
          } else if (arg.pattern !== DEFAULT_PATTERN) {
            // pattern is default one, so leave it as a string
            params[arg.name] = m[i + 1];
          } else {
            valid = false;
          }
        });
      }

      if (valid) {
        matches.push({ fn: rule.fn, params });
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

      m.fn(N, urlStr, m.params, function (err, url) {
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
