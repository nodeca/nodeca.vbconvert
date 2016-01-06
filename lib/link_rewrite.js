
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
    callback(null, N.router.linkTo('forum.index', linkDefaults));
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
          topic_hid:   topic.hid
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


  // The list of rules and functions to execute if they match
  //
  var rules = {
    '/f:forum/thread:thread.html#post:post':              link_to_post,
    '/f:forum/thread:thread-:page.html#post:post':        link_to_post,
    '/index.php?act=findpost&pid=:post':                  link_to_post,
    '/index.php?showtopic=:thread&view=findpost&p=:post': link_to_post,
    '/showthread.php?t=:thread&page=:page#post:post':     link_to_post,
    '/showthread.php?t=:thread#post:post':                link_to_post,
    '/f:forum/thread:thread.html':                        link_to_thread,
    '/f:forum/thread:thread-:page.html':                  link_to_thread,
    '/index.php?showtopic=:thread':                       link_to_thread,
    '/showthread.php?t=:thread&page=:page':               link_to_thread,
    '/showthread.php?t=:thread':                          link_to_thread,
    '/f:forum':                                           link_to_forum,
    '/index.php?showforum=:forum':                        link_to_forum,
    '/':                                                  link_to_index
  };


  Object.keys(rules).forEach(function (pattern) {
    var parsed = URL.parse(pattern, true);
    var rule = { fn: rules[pattern] };

    rule._path = pathRegexp(parsed.pathname, rule._path_args = []);

    if (parsed.query) {
      rule._query = {};
      rule._query_args = {};

      Object.keys(parsed.query).forEach(function (k) {
        rule._query[k] = pathRegexp(parsed.query[k], rule._query_args[k] = [], { strict: true });
      });
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
      if (rule._query) {
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
