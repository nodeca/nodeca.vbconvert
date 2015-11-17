
'use strict';

/* eslint-disable max-depth */


var _       = require('lodash');
var assert  = require('assert');
var smilies = require('./smilies');

var tags = [];
var joint_regexp = null;
var smiley_regexp = new RegExp('(' + Object.keys(smilies).map(_.escapeRegExp).join('|') + '|\n)');


// Register a tag-generating function to run when given regexp matches
//
function add_tag(regexp, fn) {
  tags.push([ regexp, fn, new RegExp('^' + regexp.source + '$', 'i') ]);
}


// Concatenate all regexps for all tags into one regexp
//
function get_joint_regexp() {
  if (joint_regexp) { return joint_regexp; }

  return new RegExp('(?:' + tags.map(function (tag) {
    return tag[0].source;
  }).join('|') + ')', 'gi');
}


add_tag(/\[\/?i\]/, function (text) {
  return { type: 'em', nesting: text[1] !== '/' ? 1 : -1, text: text };
});

add_tag(/\[\/?b\]/, function (text) {
  return { type: 'strong', nesting: text[1] !== '/' ? 1 : -1, text: text };
});

add_tag(/\[\/?u\]/, function (text) {
  return { type: 'underline', nesting: text[1] !== '/' ? 1 : -1, text: text };
});

add_tag(/\[\/?s\]/, function (text) {
  return { type: 'strikeout', nesting: text[1] !== '/' ? 1 : -1, text: text };
});

add_tag(/\[\/?(left|center|right|indent)\]/, function (text, tag) {
  return {
    type:    tag,
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

add_tag(/\[(url|email)=(?:"(.*?)"|'(.*?)'|(.*?))\]/, function (text, tag, m1, m2, m3) {
  var param = m1 || m2 || m3 || '';

  return {
    type:    tag,
    nesting: 1,
    param:   param,
    text:    text
  };
});

add_tag(/\[\/?(url|email)\]/, function (text, tag) {
  return { type: tag, nesting: text[1] !== '/' ? 1 : -1, text: text };
});

add_tag(/\[\/?color\]/, function (text) {
  return { type: 'color', nesting: text[1] !== '/' ? 1 : -1, text: text };
});

add_tag(/\[video=(?:".*?"|'.*?'|.*?)\](https?:\/\/.*?)\[\/video\]/, function (text, url) {
  return {
    type:    'video',
    param:   url,
    text:    text
  };
});

add_tag(/\[img\]\s*?(https?:\/\/(?:[^*\r\n]+?|[a-z0-9/\\._\- !]+?))\[\/img\]/i, function (text, url) {
  return {
    type:    'image',
    nesting: 0,
    param:   url,
    text:    text
  };
});

add_tag(/\[attach(?:=(right|left|config))?\](\d+)\[\/attach\]/, function (text, align, id) {
  return {
    type:    'attach',
    nesting: 0,
    param:   id,
    text:    text
  };
});


// Split input text into tokens
//
function tokenize(text) {
  var regexp = get_joint_regexp();
  var result = [];
  var match;
  var pos = 0;

  regexp.lastIndex = 0;

  while ((match = regexp.exec(text))) {
    if (match.index !== pos) {
      result.push({ type: 'text', text: text.slice(pos, match.index) });
    }

    for (var i = 0; i < tags.length; i++) {
      var lmatch = tags[i][2].exec(match[0]);

      if (lmatch) {
        result.push(tags[i][1].apply(null, lmatch));
        break;
      }
    }

    pos = match.index + match[0].length;
    regexp.lastIndex = pos;
  }

  if (text.length !== pos) {
    result.push({ type: 'text', text: text.slice(pos) });
  }

  return result;
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
// Note: this step doesn't exist in vB, but necessary here because
//       markdown doesn't support nested links
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

        if (token_src === '\n') {
          out_tokens.push({ type: 'newline', text: token_src });
        } else if (smilies[token_src]) {
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
