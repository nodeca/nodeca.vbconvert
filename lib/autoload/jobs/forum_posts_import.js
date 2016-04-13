// Convert bbcode to markdown and rebuild post
//
'use strict';


const _             = require('lodash');
const Promise       = require('bluebird');
const co            = require('co');
const memoizee      = require('memoizee');
const thenify       = require('thenify');
const url           = require('url');
const tokenize      = require('nodeca.vbconvert/lib/bbcode/tokenize');
const to_md         = require('nodeca.vbconvert/lib/bbcode/format_md');
const get_resources = require('nodeca.vbconvert/lib/bbcode/resources');

// amount of posts in a chunk
const POSTS_PER_CHUNK = 1000;

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
  const link_rewrite = thenify(require('../../link_rewrite')(N));

  let parsedUrl, linkDefaults;

  if (N.config.vbconvert.destination) {
    parsedUrl = url.parse(N.config.vbconvert.destination, null, true);
    linkDefaults = {
      protocol: parsedUrl.protocol ? parsedUrl.protocol.replace(/:$/, '') : null,
      hostname: parsedUrl.host
    };
  }

  const get_force_https_domains_reg = memoizee(function () {
    if (!N.config.vbconvert.force_https) return /(?!)/; // this will never match

    let domains = N.config.vbconvert.force_https.map(domain => {
      if (_.isRegExp(domain)) {
        return domain.source;
      }

      return '(?:.*\\.|)' + _.escapeRegExp(domain);
    });

    return new RegExp(`^(?:${domains.join('|')})$`, 'i');
  });

  const get_topic_urls = co.wrap(function* (ids) {
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

  const get_post_urls = co.wrap(function* (ids) {
    if (!ids.length) return {};

    let post_mappings = yield N.models.vbconvert.PostMapping
                                  .find({ mysql_id: { $in: _.uniq(ids) } })
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
      result[post.mysql_id] = N.router.linkTo('forum.topic', {
        section_hid: sections_by_id[topics_by_id[post.topic_id].section].hid,
        topic_hid:   topics_by_id[post.topic_id].hid,
        post_hid:    post.post_hid
      }, linkDefaults);
    });

    return result;
  });

  const get_attachment_urls = co.wrap(function* (ids) {
    if (!ids.length) return {};

    let file_mappings = yield N.models.vbconvert.FileMapping
                                  .find({ attachmentid: { $in: _.uniq(ids) } })
                                  .lean(true);

    let files_by_aid = _.keyBy(file_mappings, 'attachmentid');

    let mediainfos = yield N.models.users.MediaInfo
                               .find({ _id: {
                                 $in: _.uniq(_.map(file_mappings, 'media_id').map(String))
                               } })
                               .select('user_id media_id')
                               .lean(true);

    let media_by_id = _.keyBy(mediainfos, '_id');

    let users = yield N.models.users.User
                          .find({ _id: {
                            $in: _.uniq(_.map(mediainfos, 'user_id').map(String))
                          } })
                          .select('hid')
                          .lean(true);

    let users_by_id = _.keyBy(users, '_id');

    let result = {};

    ids.forEach(id => {
      let file  = files_by_aid[id] || {};
      let media = media_by_id[file.media_id] || { media_id: '000000000000000000000000' };
      let user  = users_by_id[media.user_id] || { hid: 1 };

      result[id] = N.router.linkTo('users.media', {
        user_hid: user.hid,
        media_id: media.media_id
      }, linkDefaults);
    });

    return result;
  });

  function get_link_mapping(links) {
    var result = {};

    return Promise.map(links, url => {
      return link_rewrite(url).then(newUrl => {
        if (url !== newUrl) result[url] = newUrl;
      });
    }).then(() => result);
  }

  N.wire.on('init:jobs', function register_forum_posts_import() {
    N.queue.registerWorker({
      name: 'forum_posts_import',

      // static id to make sure it will never be executed twice at the same time
      taskID() {
        return 'forum_posts_import';
      },

      chunksPerInstance: 1,

      * map() {
        let runid = Date.now();

        let last_post = yield N.models.vbconvert.PostMapping
                                                .findOne()
                                                .select('mysql_id')
                                                .sort({ mysql_id: -1 })
                                                .lean(true);
        let chunks = [];

        for (let i = 0; i <= last_post.mysql_id; i += POSTS_PER_CHUNK) {
          chunks.push({ from: i, to: i + POSTS_PER_CHUNK - 1, runid });
        }

        return chunks;
      },

      * process() {
        N.logger.info('Parsing chunk ' + JSON.stringify([ this.data.from, this.data.to ]));

        let postmappings = yield N.models.vbconvert.PostMapping
                                     .where('mysql_id').gte(this.data.from)
                                     .where('mysql_id').lte(this.data.to)
                                     .lean(true);

        let posts = [];
        let resources = { posts: [], topics: [], attachments: [], links: [] };

        postmappings.forEach(p => {
          let tokens = tokenize(p.text, N.config.vbconvert.smiley_map);
          let res    = get_resources(tokens);

          resources.posts       = resources.posts.concat(res.posts);
          resources.topics      = resources.topics.concat(res.topics);
          resources.attachments = resources.attachments.concat(res.attachments);
          resources.links       = resources.links.concat(res.links);

          posts.push({
            id:     p.post_id,
            mysql:  p.mysql_id,
            tokens
          });
        });

        let results = yield [
          get_post_urls(resources.posts),
          get_topic_urls(resources.topics),
          get_attachment_urls(resources.attachments),
          get_link_mapping(resources.links)
        ];

        let post_urls   = results[0];
        let topic_urls  = results[1];
        let attach_urls = results[2];
        let link_map    = results[3];

        Promise.map(posts, co.wrap(function* (post_ref) {
          let imports = [];
          let res     = get_resources(post_ref.tokens);

          res.posts.forEach(postid => imports.push(post_urls[postid]));
          res.topics.forEach(topicid => imports.push(topic_urls[topicid]));

          imports = _.sortedUniq(imports.sort());

          let md;

          // Remove junk images
          //
          post_ref.tokens = post_ref.tokens.filter(function (token) {
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

          post_ref.tokens = post_ref.tokens.filter(function (token, i) {
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

            for (let j = i + 1; j < post_ref.tokens.length && post_ref.tokens[j].peer !== token; j++) {
              contents += post_ref.tokens[j].text;
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

              if (is_autolink) {
                for (let j = i + 1; j < post_ref.tokens.length && post_ref.tokens[j].peer !== token; j++) {
                  if (post_ref.tokens[j].text.match(/https?:\/\/forum\.rcdesign\.ru/)) {
                    post_ref.tokens[j].text = post_ref.tokens[j].text.replace(
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
          post_ref.tokens.forEach(function (token) {
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

          try {
            md = to_md(post_ref.tokens, {
              posts:         post_urls,
              topics:        topic_urls,
              attachments:   attach_urls,
              link_replacer: function (urlStr, is_image) {
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
              }
            });
          } catch (err) {
            N.logger.warn('Failed to parse post id=' + post_ref.mysql + ': ' + err.message);
            return;
          }

          let post = yield N.models.forum.Post.findById(post_ref.id);

          if (!post) {
            throw new Error('Mapping to unknown post ' + post_ref.id);
          }

          let params = yield N.models.core.MessageParams.getParams(post.params_ref);

          let result = yield N.parse({
            text:         md,
            attachments:  post.attach,
            options:      params,
            imports,
            import_users: post.import_users,
            image_info:   post.image_info
          });

          let updateData = {
            md,
            tail: result.tail,
            html: result.html
          };

          [ 'imports', 'import_users', 'image_info' ].forEach(function (field) {
            if (!_.isEmpty(result[field])) {
              updateData[field] = result[field];
            } else {
              updateData.$unset = updateData.$unset || {};
              updateData.$unset[field] = true;
            }
          });

          yield N.models.forum.Post.update({ _id: post._id }, updateData);
        }), { concurrency: 50 });

        //
        // Send stat update to client
        //

        let data = yield this.task.worker.status(this.task.id);

        if (data) {
          let task_info = {
            current: data.chunks.done + data.chunks.errored,
            total:   data.chunks.done + data.chunks.errored +
                     data.chunks.active + data.chunks.pending,
            runid:   this.data.runid
          };

          N.live.debounce('admin.vbconvert.forum_posts', task_info);
        }

        return this.data.runid;
      },

      reduce(chunksResult) {
        var task_info = {
          current: 1,
          total:   1,
          runid:   chunksResult[0] || 0
        };

        N.live.emit('admin.vbconvert.forum_posts', task_info);
      }
    });
  });
};
