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
const url           = require('url');
const tokenize      = require('nodeca.vbconvert/lib/bbcode/tokenize');
const to_md         = require('nodeca.vbconvert/lib/bbcode/format_md');
const get_resources = require('nodeca.vbconvert/lib/bbcode/resources');
const html_unescape = require('./html_unescape_entities');


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
  const link_rewrite = require('./link_rewrite')(N);

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

  async function get_topic_urls(ids) {
    if (!ids.length) return {};

    let topics = await N.models.forum.Topic.find()
                           .where('hid').in(_.uniq(ids))
                           .select('hid section')
                           .lean(true);

    let topics_by_hid = {};

    topics.forEach(topic => { topics_by_hid[topic.hid] = topic; });

    let sections = await N.models.forum.Section.find()
                             .where('_id').in(_.uniq(_.map(topics, 'section').map(String)))
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
  }

  async function get_post_urls(ids) {
    if (!ids.length) return {};

    let post_mappings = await N.models.vbconvert.PostMapping.find()
                                  .where('mysql').in(_.uniq(ids))
                                  .lean(true);

    let topics = await N.models.forum.Topic.find()
                           .where('_id').in(_.uniq(_.map(post_mappings, 'topic_id').map(String)))
                           .select('hid section')
                           .lean(true);

    let topics_by_id = {};

    topics.forEach(topic => { topics_by_id[topic._id] = topic; });

    let sections = await N.models.forum.Section.find()
                             .where('_id').in(_.uniq(_.map(topics, 'section').map(String)))
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
  }

  async function get_blog_urls(ids) {
    if (!ids.length) return {};

    let blog_mappings = await N.models.vbconvert.BlogTextMapping.find()
                                  .where('blogtextid').in(_.uniq(ids))
                                  .lean(true);

    let blog_mappings_by_id = _.keyBy(blog_mappings, 'blogtextid');

    let blog_comments = [];
    let blog_entries  = [];

    let blog_mappings_entries  = blog_mappings.filter(m => !m.is_comment);
    let blog_mappings_comments = blog_mappings.filter(m => m.is_comment);

    if (blog_mappings_entries.length) {
      let entries = await N.models.blogs.BlogEntry.find()
                              .where('_id').in(_.map(blog_mappings_entries, 'mongo'))
                              .select('user hid')
                              .lean(true);

      blog_entries = blog_entries.concat(entries);
    }

    if (blog_mappings_comments.length) {
      let comments = await N.models.blogs.BlogComment.find()
                               .where('_id').in(_.map(blog_mappings_comments, 'mongo'))
                               .select('user entry hid')
                               .lean(true);

      let entries = await N.models.blogs.BlogEntry.find()
                              .where('_id').in(_.uniq(_.map(comments, 'entry').map(String)))
                              .select('user hid')
                              .lean(true);

      blog_comments = blog_comments.concat(comments);
      blog_entries  = blog_entries.concat(entries);
    }

    let entries_by_id  = _.keyBy(blog_entries, '_id');
    let comments_by_id = _.keyBy(blog_comments, '_id');

    let users = await N.models.users.User.find()
                          .where('_id').in(_.uniq(_.map(blog_entries, 'user').map(String)))
                          .select('hid')
                          .lean(true);

    let users_by_id = _.keyBy(users, '_id');

    let result = {};

    ids.forEach(id => {
      let map = blog_mappings_by_id[id];

      if (!map) return;

      let comment, entry;

      if (map.is_comment) {
        comment = comments_by_id[map.mongo] || {};
        entry   = entries_by_id[comment.entry] || {};
      } else {
        comment = {};
        entry   = entries_by_id[map.mongo] || {};
      }

      let user = users_by_id[entry.user] || { hid: 1 };

      result[id] = N.router.linkTo('blogs.entry', {
        user_hid:  user.hid,
        entry_hid: entry.hid,
        $anchor:   comment.hid ? `comment${comment.hid}` : null
      }, linkDefaults);
    });

    return result;
  }

  async function get_attachment_urls(ids) {
    if (!ids.length) return {};

    let file_mappings = await N.models.vbconvert.FileMapping.find()
                                  .where('attachmentid').in(_.uniq(ids))
                                  .lean(true);

    let files_by_aid = _.keyBy(file_mappings, 'attachmentid');

    let mediainfos = await N.models.users.MediaInfo.find()
                               .where('_id').in(_.uniq(_.map(file_mappings, 'media_id').map(String)))
                               .select('user media_id')
                               .lean(true);

    let media_by_id = _.keyBy(mediainfos, '_id');

    let users = await N.models.users.User.find()
                          .where('_id').in(_.uniq(_.map(mediainfos, 'user').map(String)))
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
  }

  async function get_link_mapping(links) {
    let result = {};

    await Promise.all(links.map(async url => {
      let newUrl = await link_rewrite(url);

      if (url !== newUrl) result[url] = newUrl;
    }));

    return result;
  }


  return async function parse_bbcode(posts) {
    let parsed = [];
    let resources = { posts: [], topics: [], blog_texts: [], attachments: [], links: [] };

    posts.forEach(post => {
      let tokens = tokenize(html_unescape(post.text), N.config.vbconvert.smiley_map);

      // Replace [right][snapback]1234[/snapback][/right] with post link
      // (needs to be before get_resources call for posts to fetch)
      //
      let quote_stack = [];

      tokens = tokens.filter(function (token, i) {
        // remove link tokens flagged for deletion (see below)
        if (token._delete_me) return false;

        // keep track of the current [quote]
        if (token.type === 'quote') {
          if (token.nesting === 1) quote_stack.push(token);
          else if (token.nesting === -1) quote_stack.pop();
        }

        if (token.type !== 'right') return true;

        if (!quote_stack.length) return true;

        if (tokens[i + 2] === token.peer) {
          if (tokens[i + 1] && tokens[i + 1].type === 'text') {
            let m;

            if ((m = tokens[i + 1].text.match(/^\[snapback\](\d+)\[\/snapback\]$/))) {
              let current_quote = quote_stack[quote_stack.length - 1];

              current_quote.param = current_quote.param + ';' + m[1];
              tokens[i + 1]._delete_me = true;
              tokens[i + 2]._delete_me = true;
              return false;
            }
          }
        }
      });

      let res = get_resources(tokens);

      resources.posts       = resources.posts.concat(res.posts);
      resources.topics      = resources.topics.concat(res.topics);
      resources.blog_texts  = resources.topics.concat(res.blog_texts);
      resources.attachments = resources.attachments.concat(res.attachments);
      resources.links       = resources.links.concat(res.links);

      parsed.push({ post, tokens });
    });

    let [
      post_urls,
      topic_urls,
      blog_urls,
      attach_urls,
      link_map
    ] = await Promise.all([
      get_post_urls(resources.posts),
      get_topic_urls(resources.topics),
      get_blog_urls(resources.blog_texts),
      get_attachment_urls(resources.attachments),
      get_link_mapping(resources.links)
    ]);

    return (await Promise.all(parsed.map(async function (data) {
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
            let replyto = param.match(/^\s*(.*)\s*;\s*(\w+)\s*$/);

            if (replyto && replyto[2].match(/^\d+$/)) {
              let u = post_urls[replyto[2]];
              if (u) return u;
            } else if (replyto && replyto[2].match(/^bt\d+$/)) {
              let u = blog_urls[replyto[2].slice(2)];
              if (u) return u;
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

        let result = await N.parser.md2html({
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
    }))).filter(Boolean);
  };
};
