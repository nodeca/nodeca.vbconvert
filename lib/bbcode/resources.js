
'use strict';


// Return IDs of external resources needed to build a post
//
module.exports = function (tokens) {
  let result = {
    posts: [],
    topics: [],
    blog_texts: [],
    attachments: [],
    links: []
  };

  tokens.forEach(function (token, i) {
    let j, contents;

    if (token.nesting === -1) return;

    if (token.type === 'quote') {
      let replyto = (token.param || '').match(/^\s*(.*)\s*;\s*(\w+)\s*$/);

      if (replyto && replyto[2].match(/^\d+$/)) {
        result.posts.push(replyto[2]);
      } else if (replyto && replyto[2].match(/^bt\d+$/)) {
        result.blog_texts.push(replyto[2].slice(2));
      }
    }

    if (token.type === 'attach') {
      result.attachments.push(token.param);
    }

    if (token.type === 'thread' || token.type === 'post') {
      if (token.param) {
        result[token.type === 'thread' ? 'topics' : 'posts'].push(token.param);
      } else {
        contents = '';

        for (j = i + 1; j < tokens.length && tokens[j].peer !== token; j++) {
          contents += tokens[j].text;
        }

        result[token.type === 'thread' ? 'topics' : 'posts'].push(contents);
      }
    }

    if (token.type === 'url' || token.type === 'video' || token.type === 'image') {
      if (token.param) {
        result.links.push(token.param);
      } else {
        contents = '';

        for (j = i + 1; j < tokens.length && tokens[j].peer !== token; j++) {
          contents += tokens[j].text;
        }

        result.links.push(contents);
      }
    }

    if (token.type === 'text-link') {
      result.links.push(token.param);
    }
  });

  return result;
};
