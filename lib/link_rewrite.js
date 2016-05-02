
'use strict';

const URL = require('url');
const pathRegexp = require('path-to-regexp');

// amount of posts per page on the old forum
const POSTS_PER_PAGE = 40;

// placeholders if data is not available
const PH_USER_HID    = 1;
const PH_SECTION_HID = 1;
const PH_OBJECTID    = '000000000000000000000000';

// cyrillic transliteration table
const transliterate_table = {
  а: 'a',   б: 'b',    в: 'v',  г: 'g',  д: 'd',  е: 'e',
  ж: 'zh',  з: 'z',    и: 'i',  й: 'j',  к: 'k',  л: 'l',
  м: 'm',   н: 'n',    о: 'o',  п: 'p',  р: 'r',  с: 's',
  т: 't',   у: 'u',    ф: 'f',  х: 'h',  ц: 'c',  ч: 'ch',
  ш: 'sh',  щ: 'sch',  ъ: "'",  ы: 'y',  ь: "'",  э: 'e',
  ю: 'yu',  я: 'ya',   ё: 'yo' };

const transliterate_reg = new RegExp(Object.keys(transliterate_table).join('|'), 'g');

function slugify(text) {
  return text.toLowerCase()
             .replace(transliterate_reg, function (k) {
                return transliterate_table[k];
              })
             .replace(/'/g, '')
             .replace(/[^\w]+/g, '-');
}


module.exports = function (N) {
  var compiled = [];


  // Links to index page
  //
  function link_to_index(N, urlStr, params, callback) {
    callback(null, { apiPath: 'forum.index' });
  }


  // Links to forum section
  //
  function link_to_forum(N, urlStr, params, callback) {
    callback(null, {
      apiPath: 'forum.section',
      params:  { section_hid: params.forum }
    });
  }


  // Links to category
  //
  function link_to_category(N, urlStr, params, callback) {
    N.models.forum.Section
        .find()
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

      callback(null, { apiPath: 'forum.index', hash });
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

    if (!params.thread) {
      callback();
      return;
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
        callback(null, {
          apiPath: 'forum.topic',
          params: {
            section_hid: params.forum || PH_SECTION_HID,
            topic_hid:   params.thread,
            post_hid
          }
        });
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
          callback(null, {
            apiPath: 'forum.topic',
            params: {
              section_hid: params.forum || PH_SECTION_HID,
              topic_hid:   params.thread,
              post_hid
            }
          });
          return;
        }

        callback(null, {
          apiPath: 'forum.topic',
          params: {
            section_hid: section.hid,
            topic_hid:   topic.hid,
            post_hid
          }
        });
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

          callback(null, {
            apiPath: 'forum.topic',
            params: {
              section_hid: section.hid,
              topic_hid:   topic.hid,
              post_hid:    post_mapping.post_hid
            }
          });
        });
      });
    });
  }


  // Links to attachment
  //
  function link_to_attach(N, urlStr, params, callback) {
    N.models.vbconvert.FileMapping
        .findOne({ attachmentid: params.attachmentid })
        .lean(true)
        .exec(function (err, file_mapping) {

      if (err) {
        callback(err);
        return;
      }

      if (!file_mapping) {
        callback(null, {
          apiPath: 'users.media',
          params: {
            user_hid: PH_USER_HID,
            media_id: PH_OBJECTID
          }
        });
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
          callback(null, {
            apiPath: 'users.media',
            params: {
              user_hid: PH_USER_HID,
              media_id: PH_OBJECTID
            }
          });
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

          callback(null, {
            apiPath: 'users.media',
            params: {
              user_hid: user ? user.hid : PH_USER_HID,
              media_id: mediainfo.media_id
            }
          });
        });
      });
    });
  }


  // Links to attachment image
  //
  function link_to_attach_raw(field, defaultSize) {
    return function (N, urlStr, params, callback) {
      let size = defaultSize || 'orig';

      if (params.isthumb) size = 'sm';

      function make_result(user_hid, media_id) {
        return {
          apiPath: 'core.gridfs',
          params: {
            bucket: media_id + (size === 'orig' ? '' : `_${size}`)
          },

          // Metadata needed to replace direct links to images with links to media:
          // ![](/files/foobar) → ![orig](/media/foobar)
          //
          user_hid,
          media_id,
          size
        };
      }

      if (!field) {
        callback(null, make_result(PH_USER_HID, PH_OBJECTID));
        return;
      }

      let query = {};

      query[field] = params[field];

      N.models.vbconvert.FileMapping
          .findOne(query)
          .lean(true)
          .exec(function (err, file_mapping) {

        if (err) {
          callback(err);
          return;
        }

        if (!file_mapping) {
          callback(null, make_result(PH_USER_HID, PH_OBJECTID));
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
            callback(null, make_result(PH_USER_HID, PH_OBJECTID));
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

            callback(null, make_result(user ? user.hid : PH_USER_HID, mediainfo.media_id));
          });
        });
      });
    };
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
        callback(null, {
          apiPath: 'users.album',
          params: {
            user_hid: PH_USER_HID,
            album_id: PH_OBJECTID
          }
        });
        return;
      }

      N.models.users.Album
          .findById(album_mapping.mongo)
          .select('user')
          .lean(true)
          .exec(function (err, album) {

        if (err) {
          callback(err);
          return;
        }

        if (!album) {
          callback(null, {
            apiPath: 'users.album',
            params: {
              user_hid: PH_USER_HID,
              album_id: PH_OBJECTID
            }
          });
          return;
        }

        N.models.users.User
            .findById(album.user)
            .select('hid')
            .lean(true)
            .exec(function (err, user) {

          if (err) {
            callback(err);
            return;
          }

          callback(null, {
            apiPath: 'users.album',
            params: {
              user_hid: user ? user.hid : PH_USER_HID,
              album_id: album._id
            }
          });
        });
      });
    });
  }


  // Links to user profile
  //
  function link_to_user(N, urlStr, params, callback) {
    callback(null, {
      apiPath: 'users.member',
      params: { user_hid: params.user }
    });
  }


  // Links to the list of all user albums
  //
  function link_to_album_list(ldb, urlStr, params, callback) {
    callback(null, {
      apiPath: 'users.albums_root',
      params: { user_hid: params.user }
    });
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
          callback(null, {
            apiPath: 'core.gridfs',
            params: {
              bucket: PH_OBJECTID + (size && size !== 'orig' ? '_' + size : '')
            }
          });
          return;
        }

        callback(null, {
          apiPath: 'core.gridfs',
          params: {
            bucket: user.avatar_id + (size && size !== 'orig' ? '_' + size : '')
          }
        });
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
    '/f:forum/thread:thread.html#post:post':           link_to_post,
    '/f:forum/thread:thread-:page.html#post:post':     link_to_post,
    '/f:forum/thread:thread-post:post.html':           link_to_post,
    '/thread:thread.html#post:post':                   link_to_post,
    '/thread:thread-:page.html#post:post':             link_to_post,
    '/showthread.php?t=:thread#post:post':             link_to_post,
    '/showthread.php?p=:post':                         link_to_post,
    '/showpost.php?p=:post':                           link_to_post,

    // forum posts with old style anchors
    '/f:forum/thread:thread.html#entry:post':          link_to_post,
    '/f:forum/thread:thread-:page.html#entry:post':    link_to_post,
    '/showthread.php?t=:thread#entry:post':            link_to_post,

    // forum topics
    '/f:forum/thread:thread.html':                     link_to_thread,
    '/f:forum/thread:thread-:page.html':               link_to_thread,
    '/thread:thread.html':                             link_to_thread,
    '/thread:thread-:page.html':                       link_to_thread,
    '/showthread.php?t=:thread&page=:page':            link_to_thread,
    '/showthread.php?t=:thread':                       link_to_thread,

    // users copied this link from the wrong place
    '/f:forum/thread:thread-new-post.html':            link_to_thread,

    // forum sections
    '/f:forum':                                        link_to_forum,
    '/#:slug(.+)':                                     link_to_category,

    // users
    '/member.php?u=:user':                             link_to_user,

    // albums
    '/attachment.php?attachmentid=:attachmentid&thumb=:isthumb': link_to_attach_raw('attachmentid'),
    '/attachment.php?attachmentid=:attachmentid':                link_to_attach_raw('attachmentid'),
    '/album.php?albumid=:album&attachmentid=:attachmentid':      link_to_attach,
    '/album.php?albumid=:album&page=:page':                      link_to_album,
    '/album.php?albumid=:album':                                 link_to_album,
    '/album.php?u=:user':                                        link_to_album_list,
    '/uploads/posts/([0-9]+)+/:filedataid.thumb':                link_to_attach_raw('filedataid', 'sm'),
    '/blog_attachment.php?attachmentid=:blogaid_legacy':         link_to_attach_raw('blogaid_legacy'),
    '/picture.php?albumid=:album&pictureid=:pictureaid_legacy':  link_to_attach_raw('pictureaid_legacy'),

    // avatars
    // note: `:u(_)` captures underscore, because underscore in :user_:ver
    // is interpreted as part if identifier (i.e. ':user_' + ':ver')
    '/customavatars/avatar:user:u(_):ver.gif':         link_to_avatar('md'),
    '/customavatars/thumbs/avatar:user:u(_):ver.gif':  link_to_avatar('md'),
    '/customprofilepics/profilepic:user:u(_):ver.gif': link_to_avatar('orig'),

    //
    // Rules from previous versions (ipb_rewrite.php)
    //

    // forum posts
    '/?act=findpost&pid=:post':                        link_to_post,
    '/index.php?act=findpost&p=:post':                 link_to_post,
    '/index.php?act=findpost&pid=:post':               link_to_post,
    '/index.php?showtopic=:thread&p=:post':            link_to_post,
    '/index.php?showtopic=:thread&pid=:post':          link_to_post,
    '/index.php?showtopic=:thread&gopid=:post':        link_to_post,
    '/index.php?act=ST&f=:forum&t=:thread#entry:post': link_to_post,
    '/index.php?act=ST&view=findpost&p=:post':         link_to_post,

    // forum topics
    '/index.php?showtopic=:thread&start=:start':       link_to_thread,
    '/index.php?showtopic=:thread&st=:start':          link_to_thread,
    '/index.php?showtopic=:thread':                    link_to_thread,
    '/index.php?act=ST&f=:forum&t=:thread&st=:start':  link_to_thread,
    '/index.php?act=ST&f=:forum&t=:thread':            link_to_thread,
    '/index.php?act=Print&f=:forum&t=:thread':         link_to_thread,

    // forum sections
    '/index.php?showforum=:forum':                     link_to_forum,
    '/index.php?act=SF&f=:forum':                      link_to_forum,

    // users
    '/index.php?showuser=:user':                       link_to_user,

    // albums
    '/index.php?act=([Aa])ttach&type=blogentry&id=:blogaid_legacy':
                                                       link_to_attach_raw('blogaid_legacy'),
    '/index.php?act=([Aa])ttach&id=:attachmentid':     link_to_attach_raw('attachmentid'),
    '/index.php?op=view_album&album=:album':           link_to_album,

    //
    // LoFi version (text)
    //

    // forum topics
    '/lofiversion/index.php/t:thread-:page.html':      link_to_thread,
    '/lofiversion/index.php/t:thread.html':            link_to_thread,
    '/lofiversion/index.php?t:thread-:page.html':      link_to_thread,
    '/lofiversion/index.php?t:thread.html':            link_to_thread,

    // forum sections
    '/lofiversion/index.php/f:forum.html':             link_to_forum,
    '/lofiversion/index.php?f:forum.html':             link_to_forum,

    // main page
    '/lofiversion/index.php':                          link_to_index,

    //
    // Default rules
    //
    // Skip links with known arguments and convert the rest to the index page
    //
    '/uploads/:anything(.+)':                          link_to_attach_raw(null, 'orig'),
    '/index.php?act=:anything(.+)':                    do_not_convert,
    '/index.php?autocom=:anything(.+)':                do_not_convert,
    '/index.php?automodule=:anything(.+)':             do_not_convert,
    '/index.php':                                      link_to_index,
    '/':                                               link_to_index
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
      m = rule._path.exec(url.pathname.replace(/^\/\.\./, ''));

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
