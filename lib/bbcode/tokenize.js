
'use strict';

/* eslint-disable max-depth */


var _       = require('lodash');
var assert  = require('assert');
var smilies = require('./smilies');

var tags = [];
var joint_regexp = null;
var smiley_regexp = new RegExp('(' + Object.keys(smilies).map(_.escapeRegExp).join('|') + ')');


// Register a tag-generating function to run when given regexp matches
//
function add_tag(regexp, fn) {
  tags.push([ regexp, fn, new RegExp('^(' + regexp.source + ')$', 'i') ]);
}


// Concatenate all regexps for all tags into one regexp
//
function get_joint_regexp() {
  if (joint_regexp) { return joint_regexp; }

  return new RegExp('(' + tags.map(function (tag) {
    return tag[0].source;
  }).join('|') + ')', 'i');
}


add_tag(/\n/, function (text) {
  return { type: 'newline', text: text };
});

add_tag(/\[\/?i\]/, function (text) {
  return { type: 'em', nesting: text[1] !== '/' ? 1 : -1, text: text };
});

add_tag(/\[\/?b\]/, function (text) {
  return { type: 'strong', nesting: text[1] !== '/' ? 1 : -1, text: text };
});

add_tag(/\[\/?u\]/, function (text) {
  return { type: 'underline', nesting: text[1] !== '/' ? 1 : -1, text: text };
});

add_tag(/\[\/?(?:left|center|right|indent)\]/, function (text) {
  return {
    type:    text.replace(/[^a-z]/ig, '').toLowerCase(),
    nesting: text[1] !== '/' ? 1 : -1,
    text:    text
  };
});

add_tag(/\[quote\][ \t]*/, function (text) {
  return { type: 'quote', nesting: 1, text: text };
});

add_tag(/[ \t]*\[\/quote\][ \t]*/, function (text) {
  return { type: 'quote', nesting: -1, text: text };
});

add_tag(/\[quote=(?:".*?"|'.*?'|.*?)\][ \t]*/, function (text) {
  var m = text.match(/^\[quote=(?:"(.*?)"|'(.*?)'|(.*?))\][ \t]*$/i);
  var param = m[1] || m[2] || m[3] || '';
  var replyto = param.match(/^\s*(.*)\s*;\s*(\d+)\s*$/);

  return {
    type:    'quote',
    nesting: 1,
    param:   param,
    replyto: replyto ? [ replyto[1].replace(/^\s+|\s+$/g, ''), Number(replyto[2]) ] : null,
    text:    text
  };
});

add_tag(/\[url=(?:".*?"|'.*?'|.*?)\]/, function (text) {
  var m = text.match(/^\[url=(?:"(.*?)"|'(.*?)'|(.*?))\]$/i);
  var param = m[1] || m[2] || m[3] || '';

  return {
    type:    'url',
    nesting: 1,
    param:   param,
    text:    text
  };
});

add_tag(/\[url\]/, function (text) {
  return { type: 'url', nesting: 1, text: text };
});

add_tag(/\[\/url\]/, function (text) {
  return { type: 'url', nesting: -1, text: text };
});

add_tag(/\[video=(?:".*?"|'.*?'|.*?)\]https?:\/\/.*?\[\/video\]/, function (text) {
  var m = text.match(/^\[video=(?:".*?"|'.*?'|.*?)\](https?:\/\/.*?)\[\/video\]$/i);
  var param = m[1];

  return {
    type:    'video',
    param:   param,
    text:    text
  };
});

add_tag(/\[img\]https?:\/\/.*?\[\/img\]/, function (text) {
  var m = text.match(/^\[img\](https?:\/\/.*?)\[\/img\]$/i);
  var param = m[1];

  return {
    type:    'image',
    nesting: 0,
    param:   param,
    text:    text
  };
});

add_tag(/\[attach\]\d+\[\/attach\]/, function (text) {
  return {
    type:    'attach',
    nesting: 0,
    param:   text.replace(/[^\d]/g, ''),
    text:    text
  };
});


// Split input text into tokens
//
function tokenize(text) {
  return text.split(get_joint_regexp())
             .filter(Boolean)
             .map(function (token_src) {

    for (var i = 0; i < tags.length; i++) {
      if (tags[i][2].test(token_src)) {
        return tags[i][1](token_src);
      }
    }

    return { type: 'text', text: token_src };
  });
}

// Replace unpaired tags (opening tags with no closing
// counterparts or vice versa) with text
//
function remove_unpaired(tokens) {
  var opened = {};
  var length = tokens.length;

  for (var i = 0; i < length; i++) {
    if (tokens[i].nesting === 1) {
      opened[tokens[i].type] = opened[tokens[i].type] || [];
      opened[tokens[i].type].push(i);
    } else if (tokens[i].nesting === -1) {
      opened[tokens[i].type] = opened[tokens[i].type] || [];

      if (opened[tokens[i].type].length) {
        opened[tokens[i].type].pop();
      } else {
        tokens[i] = { type: 'text', text: tokens[i].text };
      }
    }
  }

  Object.keys(opened).forEach(function (k) {
    opened[k].forEach(function (i) {
      tokens[i] = { type: 'text', text: tokens[i].text };
    });
  });

  return tokens;
}


// Avoid nested links, e.g.:
//
// in:  [url="foo"]foo [url="bar"]bar[/url] baz[/url]
// out: [url="foo"]foo [/url][url="bar"]bar[/url] baz
//
function balance_links(tokens) {
  var opening = null, token;

  for (var i = 0; i < tokens.length; i++) {
    if (tokens[i].type === 'url') {
      if (tokens[i].nesting === 1) {
        if (opening) {
          token = _.assign({}, opening);
          token.nesting = -1;
          tokens.splice(i, 0, token);
          i++;
        }

        opening = tokens[i];
      } else {
        if (!opening) {
          tokens.splice(i, 1);
          i--;
        }

        opening = null;
      }
    }
  }

  return tokens;
}


// Fix overlapping tags
//
function balance(tokens) {
  var opened = [];
  var out_tokens = [];

  for (var i = 0; i < tokens.length; i++) {
    if (tokens[i].nesting === 1) {
      out_tokens.push(tokens[i]);
      opened.push(tokens[i]);
    } else if (tokens[i].nesting === -1) {
      var found = -1, j, token;

      for (j = opened.length - 1; j >= 0; j--) {
        if (opened[j].type === tokens[i].type) {
          found = j;
          break;
        }
      }

      assert(found !== -1);

      for (j = opened.length - 1; j > found; j--) {
        token = _.assign({}, opened[j]);

        token.nesting = -1;
        out_tokens.push(token);
      }

      out_tokens.push(tokens[i]);

      for (j = found + 1; j < opened.length; j++) {
        token = _.assign({}, opened[j]);

        token.nesting = 1;
        out_tokens.push(token);
      }

      opened.splice(found, 1);
    } else {
      out_tokens.push(tokens[i]);
    }
  }

  return out_tokens;
}


// Find smilies in the text tokens and turn them into standalone tokens
//
function add_smilies(tokens) {
  var out_tokens = [];

  tokens.forEach(function (token) {
    if (token.type === 'text') {
      token.text.split(smiley_regexp)
                .filter(Boolean)
                .forEach(function (token_src) {

        if (smilies[token_src]) {
          out_tokens.push({ type: 'smiley', text: token_src, name: smilies[token_src] });
        } else {
          out_tokens.push({ type: 'text', text: token_src });
        }
      });
    } else {
      out_tokens.push(token);
    }
  });

  return out_tokens;
}


// Remove empty tags, and mark all counterparts in pairs
//
function cleanup(tokens) {
  var opened = [];
  var length = tokens.length;

  for (var i = 0; i < length; i++) {
    if (tokens[i].nesting === 1) {
      opened.push(i);
    } else if (tokens[i].nesting === -1) {
      var j = opened.pop();

      if (j === i - 1) {
        tokens.splice(j, 2);
        i -= 2;
        length -= 2;
      } else {
        tokens[j].peer = tokens[i];
        tokens[i].peer = tokens[j];
      }
    }
  }

  return tokens;
}

module.exports = function (text) {
  return add_smilies(cleanup(balance(balance_links(remove_unpaired(tokenize(text))))));
};
