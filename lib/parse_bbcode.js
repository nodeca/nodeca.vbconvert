// Convert BBcode to markdown/HTML
//
// parse_bbcode(posts: [ Object ]): Promise([ Object ])
//
// Input value is an array of:
//  - id (Number)          - unique ID (for reference)
//  - text (String)        - BBcode source
//  - options (Object)     - parser params (for parser only)
//  - users (Array)        - list of users involved in a dialog,
//                           (nicknames would be replaced with links for those)
//  - attachments (Array)  - attachment ids (for parser only)
//
// Output is a corresponding array of:
//  - id (Number)          - unique ID (same as in input)
//  - md (String)          - generated markdown source
//  - html (String)        - generated HTML
//  - tail (Array)         - tail data (see parser docs)
//  - imports (Array)      - list of urls (see parser docs)
//  - import_users (Array) - list of users (see parser docs)
//

'use strict';

const _             = require('lodash');
const Promise       = require('bluebird');
const url           = require('url');
const tokenize      = require('nodeca.vbconvert/lib/bbcode/tokenize');
const to_md         = require('nodeca.vbconvert/lib/bbcode/format_md');
const get_resources = require('nodeca.vbconvert/lib/bbcode/resources');


/* eslint-disable max-len */
const REMOVE_LINKS = [
  [
    'Просмотр профиля',
    /^http:\/\/forum\.rcdesign\.ru\/member\.php\?u=\d+$/
  ],
  [
    'Сообщения форума',
    /^http:\/\/forum\.rcdesign\.ru\/search\.php\?do=finduser&userid=\d+&contenttype=vBForum_Post&showposts=1$/
  ],
  [
    'Темы форума',
    /^http:\/\/forum\.rcdesign\.ru\/search\.php\?do=finduser&userid=\d+&starteronly=1&contenttype=vBForum_Thread$/
  ],
  [
    'Еще в этой теме',
    /^http:\/\/forum\.rcdesign\.ru\/search\.php\?do=finduser&userid=\d+&searchthreadid=\d+&contenttype=vBForum_Post&showposts=\d+$/
  ],
  [
    'Добавить в знакомые',
    /^http:\/\/forum\.rcdesign\.ru\/profile\.php\?do=addlist&userlist=buddy&u=\d+$/
  ],
  [
    'Личное сообщение',
    /^http:\/\/forum\.rcdesign\.ru\/private\.php\?do=newpm&u=\d+/
  ],
  [
    'Записи в дневнике',
    /^http:\/\/forum\.rcdesign\.ru\/blogs\/\d+\/$/
  ],
  [
    'Ответить с цитированием',
    /^http:\/\/forum\.rcdesign\.ru\/newreply\.php\?do=newreply&p=\d+$/
  ],
  [
    'Спасибо!',
    /^http:\/\/forum\.rcdesign\.ru\/vb_votes\.php\?do=vote&targetid=\d+&value=\d+$/
  ]
];


module.exports = function (N) {
  const link_rewrite = Promise.promisify(require('./link_rewrite')(N));

  let parsedUrl, linkDefaults;

  if (N.config.vbconvert.destination) {
    parsedUrl = url.parse(N.config.vbconvert.destination, null, true);
    linkDefaults = {
      protocol: parsedUrl.protocol ? parsedUrl.protocol.replace(/:$/, '') : null,
      hostname: parsedUrl.host
    };
  }

  const get_force_https_domains_reg = _.memoize(function () {
    if (!N.config.vbconvert.force_https) return /(?!)/; // this will never match

    let domains = N.config.vbconvert.force_https.map(domain => {
      if (_.isRegExp(domain)) {
        return domain.source;
      }

      return '(?:.*\\.|)' + _.escapeRegExp(domain);
    });

    return new RegExp(`^(?:${domains.join('|')})$`, 'i');
  });

  const get_topic_urls = Promise.coroutine(function* (ids) {
    if (!ids.length) return {};

    let topics = yield N.models.forum.Topic
                                     .find({ hid: { $in: _.uniq(ids) } })
                                     .select('hid section')
                                     .lean(true);

    let topics_by_hid = {};

    topics.forEach(topic => { topics_by_hid[topic.hid] = topic; });

    let sections = yield N.models.forum.Section
                             .find({ _id: {
                               $in: _.uniq(_.map(topics, 'section').map(String))
                             } })
                            .select('hid')
                            .lean(true);

    let sections_by_id = {};

    sections.forEach(section => { sections_by_id[section._id] = section; });

    let result = {};

    ids.forEach(topic_hid => {
      result[topic_hid] = N.router.linkTo('forum.topic', {
        section_hid: topics_by_hid[topic_hid] ?
                       sections_by_id[topics_by_hid[topic_hid].section].hid :
                       1,
        topic_hid
      }, linkDefaults);
    });

    return result;
  });

  const get_post_urls = Promise.coroutine(function* (ids) {
    if (!ids.length) return {};

    let post_mappings = yield N.models.vbconvert.PostMapping
                                  .find({ mysql: { $in: _.uniq(ids) } })
                                  .lean(true);

    let topics = yield N.models.forum.Topic
                           .find({ _id: {
                             $in: _.uniq(_.map(post_mappings, 'topic_id').map(String))
                           } })
                           .select('hid section')
                           .lean(true);

    let topics_by_id = {};

    topics.forEach(topic => { topics_by_id[topic._id] = topic; });

    let sections = yield N.models.forum.Section
                            .find({ _id: {
                              $in: _.uniq(_.map(topics, 'section').map(String))
                            } })
                            .select('hid')
                            .lean(true);

    let sections_by_id = {};

    sections.forEach(section => { sections_by_id[section._id] = section; });

    let result = {};

    post_mappings.forEach(post => {
      result[post.mysql] = N.router.linkTo('forum.topic', {
        section_hid: sections_by_id[topics_by_id[post.topic_id].section].hid,
        topic_hid:   topics_by_id[post.topic_id].hid,
        post_hid:    post.post_hid
      }, linkDefaults);
    });

    return result;
  });

  const get_attachment_urls = Promise.coroutine(function* (ids) {
    if (!ids.length) return {};

    let file_mappings = yield N.models.vbconvert.FileMapping
                                  .find({ attachmentid: { $in: _.uniq(ids) } })
                                  .lean(true);

    let files_by_aid = _.keyBy(file_mappings, 'attachmentid');

    let mediainfos = yield N.models.users.MediaInfo
                               .find({ _id: {
                                 $in: _.uniq(_.map(file_mappings, 'media_id').map(String))
                               } })
                               .select('user media_id')
                               .lean(true);

    let media_by_id = _.keyBy(mediainfos, '_id');

    let users = yield N.models.users.User
                          .find({ _id: {
                            $in: _.uniq(_.map(mediainfos, 'user').map(String))
                          } })
                          .select('hid')
                          .lean(true);

    let users_by_id = _.keyBy(users, '_id');

    let result = {};

    ids.forEach(id => {
      let file  = files_by_aid[id] || {};
      let media = media_by_id[file.media_id] || { media_id: '000000000000000000000000' };
      let user  = users_by_id[media.user] || { hid: 1 };

      result[id] = N.router.linkTo('users.media', {
        user_hid: user.hid,
        media_id: media.media_id
      }, linkDefaults);
    });

    return result;
  });

  function get_link_mapping(links) {
    var result = {};

    return Promise.map(links, function (url) {
      return link_rewrite(url).then(function (newUrl) {
        if (url !== newUrl) result[url] = newUrl;
      });
    }).then(() => result);
  }


  return Promise.coroutine(function* parse_bbcode(posts) {
    let parsed = [];
    let resources = { posts: [], topics: [], attachments: [], links: [] };

    posts.forEach(post => {
      let tokens = tokenize(post.text, N.config.vbconvert.smiley_map);
      let res    = get_resources(tokens);

      resources.posts       = resources.posts.concat(res.posts);
      resources.topics      = resources.topics.concat(res.topics);
      resources.attachments = resources.attachments.concat(res.attachments);
      resources.links       = resources.links.concat(res.links);

      parsed.push({ post, tokens });
    });

    let results = yield Promise.all([
      get_post_urls(resources.posts),
      get_topic_urls(resources.topics),
      get_attachment_urls(resources.attachments),
      get_link_mapping(resources.links)
    ]);

    let post_urls   = results[0];
    let topic_urls  = results[1];
    let attach_urls = results[2];
    let link_map    = results[3];

    return (yield Promise.map(parsed, Promise.coroutine(function* (data) {
      let post = data.post;

      try {
        let tokens  = data.tokens;
        let imports = [];
        let res     = get_resources(tokens);

        res.posts.forEach(postid => imports.push(post_urls[postid]));
        res.topics.forEach(topicid => imports.push(topic_urls[topicid]));

        // check if there are any plain links to topics/posts
        res.links.forEach(urlStr => {
          let link = link_map[urlStr] || urlStr;

          if (!_.isObject(link) || !link.apiPath) return true;

          if (link.apiPath === 'forum.section' || link.apiPath === 'forum.topic') {
            imports.push(N.router.linkTo(link.apiPath, link.params, linkDefaults));
          }
        });

        imports = _.sortedUniq(imports.sort());

        // Remove junk images
        //
        tokens = tokens.filter(function (token) {
          if (token.type !== 'image') return true;

          let link = link_map[token.param] || token.param;

          if (_.isObject(link) && link.apiPath) return true;

          let urlObj = url.parse(link, true, true);

          if (urlObj.hostname !== 'forum.rcdesign.ru') return true;

          if (urlObj.pathname.match(/^\/clear\.gif/) ||
              urlObj.pathname.match(/^\/clientscript\//) ||
              urlObj.pathname.match(/^\/style_images\//) ||
              urlObj.pathname.match(/^\/style_emoticons\//) ||
              urlObj.pathname.match(/^\/images\//) ||
              urlObj.pathname.match(/^\/image\/[^;\/]+;base64/)) {

            return false;
          }

          return true;
        });

        // Remove invalid links (search, profile, etc.)
        //
        let link_end = null;

        tokens = tokens.filter(function (token, i) {
          // remove everything up to link_end if it's defined
          if (link_end) {
            if (token === link_end) link_end = null;

            return false;
          }

          // closing link tokens flagged for deletion (see below)
          if (token._delete_me) return false;

          // skip everything else except opening links
          if (token.type !== 'url' || token.nesting !== 1) return true;

          // get url
          let is_autolink = !token.param;
          let contents = '';
          let link, link_orig;

          for (let j = i + 1; j < tokens.length && tokens[j].peer !== token; j++) {
            contents += tokens[j].text;
          }

          contents = contents.trim();

          if (is_autolink) {
            link_orig = contents;
          } else {
            link_orig = token.param;
          }

          // - skip copy-pasted "answer/thanks" signature
          // - skip copy-pasted profile dialog
          //
          if (!is_autolink) {
            for (let j = 0; j < REMOVE_LINKS.length; j++) {
              if (contents === REMOVE_LINKS[j][0] && link_orig.match(REMOVE_LINKS[j][1])) {
                link_end = token.peer;
                return false;
              }
            }
          }

          link = link_map[link_orig] || link_orig;

          if (_.isObject(link) && link.apiPath) return true;

          let urlObj = url.parse(link, true, true);

          if (urlObj.hostname !== 'forum.rcdesign.ru') return true;

          // - skip copy-pasted "answer/thanks" signature
          // - skip copy-pasted profile dialog
          //
          if (!is_autolink) {
            for (let j = 0; j < REMOVE_LINKS.length; j++) {
              if (contents === REMOVE_LINKS[j][0] && urlObj.path.match(REMOVE_LINKS[j][1])) {
                link_end = token.peer;
                return false;
              }
            }
          }

          if (urlObj.path.match(/^\/search\.php\?searchid=\d+/) ||
              urlObj.path.match(/^\/search\.php\?do=(?:getnew|uservotes)/) ||
              urlObj.path.match(/^\/private\.php/)) {

            /* eslint-disable max-depth */
            if (is_autolink) {
              for (let j = i + 1; j < tokens.length && tokens[j].peer !== token; j++) {
                if (tokens[j].text.match(/https?:\/\/forum\.rcdesign\.ru/)) {
                  tokens[j].text = tokens[j].text.replace(
                    /https?:\/\/forum\.rcdesign\.ru/, 'forum.rcdesign.ru'
                  );
                }
              }
            }

            token.peer._delete_me = true;
            return false;
          }

          if (urlObj.pathname.match(/^\/style_images\//) ||
              urlObj.pathname.match(/^\/style_emoticons\//) ||
              urlObj.pathname.match(/^\/images\//)) {

            link_end = token.peer;
            return false;
          }

          return true;
        });

        // ![](/files/objectid) -> ![orig](/media/objectid)
        //
        tokens.forEach(function (token) {
          if (token.type !== 'image') return;

          let link = link_map[token.param] || token.param;

          if (!_.isObject(link)) return;
          if (link.apiPath !== 'core.gridfs') return;
          if (!link.media_id) return;

          token.param = N.router.linkTo('users.media', {
            user_hid: link.user_hid,
            media_id: link.media_id
          }, linkDefaults);

          if (link.size !== 'sm') {
            token.alt = token.alt ? `${token.alt}|${link.size}` : link.size;
          }
        });

        let force_https_domains_reg = get_force_https_domains_reg();

        let md = to_md(tokens, {
          posts:         post_urls,
          topics:        topic_urls,
          attachments:   attach_urls,

          link_replacer(urlStr, is_image) {
            let link = link_map[urlStr] || urlStr;
            let result;

            if (_.isObject(link)) {
              // internal urls, build them using N.router
              result = N.router.linkTo(link.apiPath, link.params, linkDefaults);

              if (link.hash) result += link.hash;
            } else {
              // external urls, force https on some
              if (is_image) {
                let urlObj = url.parse(link);

                if (urlObj.host && urlObj.host.match(force_https_domains_reg) && urlObj.protocol === 'http:') {
                  urlObj.protocol = 'https:';
                  link = url.format(urlObj);
                }
              }

              result = link;
            }

            return result;
          },

          quote_param_to_link(param) {
            let replyto = param.match(/^\s*(.*)\s*;\s*(\d+)\s*$/);

            if (replyto && post_urls && post_urls[replyto[2]]) {
              return post_urls[replyto[2]];
            }

            let reply_user = (data.post.users || [])
                               .filter(user => (user.nick === param))[0];

            if (reply_user) {
              return N.router.linkTo('users.member', {
                user_hid: reply_user.hid
              }, linkDefaults);
            }

            return null;
          }
        });

        let result = yield N.parser.md2html({
          text:         md,
          attachments:  post.attachments,
          options:      post.options,
          imports
        });

        return {
          id:           post.id,
          md,
          html:         result.html,
          tail:         result.tail,
          imports:      result.imports,
          import_users: result.import_users
        };
      } catch (err) {
        N.logger.error('Failed to parse post id=' + post.id + ': ' + err.stack);
        return;
      }
    }), { concurrency: 50 })).filter(Boolean);
  });
};
