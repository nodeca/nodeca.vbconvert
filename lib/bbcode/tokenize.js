
'use strict';

/* eslint-disable max-depth */
/* eslint-disable no-else-return */


var _       = require('lodash');
var assert  = require('assert');
var smilies = require('./smilies');

var allowed_tags_without_option = {
  quote: {
    strip_space: 2
  },
  spoiler: {
    // not accepted by the old forum software,
    // but people used it anyway
    strip_space: 2
  },
  highlight: {},
  noparse: {
    stop_parse:  true,
    no_smilies:  true
  },
  video: {},
  b: {},
  i: {},
  s: {},
  u: {},
  sub: {},
  sup: {},
  left: {
    strip_space: 1
  },
  center: {
    strip_space: 1
  },
  right: {
    strip_space: 1
  },
  indent: {
    strip_space: 1
  },
  list: {},
  email: {},
  url: {},
  thread: {
    // instead of data_regex in vB,
    // 'cause it's easier to implement
    followed_by: /^\d+\[\/thread\]/i
  },
  post: {
    followed_by: /^\d+\[\/post\]/i
  },
  php: {
    stop_parse:  true,
    no_smilies:  true,
    no_wordwrap: true,
    strip_space: 2
  },
  /* TODO:
  code: {
    no_smilies:  true,
    no_wordwrap: true,
    strip_space: 2
  },*/
  qr: {
    stop_parse:  true,
    no_smilies:  true,
    no_wordwrap: true
  },
  html: {
    stop_parse:  true,
    no_smilies:  true,
    no_wordwrap: true,
    strip_space: 2
  }
};

var allowed_tags_with_option = {
  quote: {
    strip_space:  2
  },
  spoiler: {
    strip_space:  2
  },
  video: {
    no_smilies:   true
  },
  color: {
    option_regex: /^\#?\w+$/
  },
  size: {
    option_regex: /^[0-9\+\-]+$/
  },
  font: {
    option_regex: /^[^["`':]+$/
  },
  list: {},
  email: {},
  url: {},
  thread: {
    option_regex: /^\d+$/
  },
  post: {
    option_regex: /^\d+$/
  }
};


var tags = [];
var joint_regexp = null;


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


add_tag(new RegExp(Object.keys(smilies).map(_.escapeRegExp).join('|')), function (text) {
  return { type: 'smiley', text: text, name: smilies[text] };
});

add_tag(/\r?\n/, function (text) {
  return { type: 'newline', text: text };
});

add_tag(/\[\*\]/, function (text) {
  return {
    type: 'list_item',
    text: text
  };
});

add_tag(/\[more\]/, function (text) {
  return {
    type: 'more',
    text: text
  };
});

add_tag(/\[img\]\s*(https?:\/\/(?:[^*\r\n]+?|[a-z0-9/\\._\- !]+?))\[\/img\]/i, function (text, url) {
  return {
    type:    'image',
    param:   url,
    text:    text
  };
});

add_tag(/\[attach(?:=(right|left|config))?\](\d+)\[\/attach\]/, function (text, align, id) {
  return {
    type:    'attach',
    param:   id,
    text:    text
  };
});


// Check whether a tag is valid
//
function is_valid_tag(closer, type, option) {
  if (typeof option !== 'undefined' && option !== null) {
    if (closer) {
      return false;
    }

    if (!allowed_tags_with_option[type]) {
      return false;
    }

    if (allowed_tags_with_option[type].option_regex) {
      return allowed_tags_with_option[type].option_regex.test(option);
    } else {
      return true;
    }
  } else {
    if (closer && allowed_tags_with_option[type]) {
      return true;
    }

    return !!allowed_tags_without_option[type];
  }
}


// Add text node to a token list
//
function add_text_node(tokens, text) {
  if (tokens.length && tokens[tokens.length - 1].type === 'text') {
    tokens[tokens.length - 1].text += text;
  } else {
    tokens.push({ type: 'text', text: text });
  }
}


// Split input text into tokens
//
function tokenize(text) {
  //             [ / ( tag name   ) (    tag option      )  ]
  var regexp = /\[\/?(?:[^=\[\]\/])+(?:=".*?"|='.*?'|=.*?)?\]/g;
  var result = [];
  var match;
  var pos = 0;

  regexp.lastIndex = 0;

  while ((match = regexp.exec(text))) {
    if (match.index !== pos) {
      add_text_node(result, text.slice(pos, match.index));
    }

    // same regexp as above, but with capture groups
    var lmatch = /\[(\/)?([^=\[\]\/]+)(="(.*?)"|='(.*?)'|=(.*?))?\]/.exec(match[0]);
    var option = lmatch[3] ? (lmatch[4] || lmatch[5] || lmatch[6] || '') : null;
    var closer = !!lmatch[1];
    var tag    = lmatch[2].toLowerCase();

    if (is_valid_tag(closer, tag, option)) {
      var config = (option === null || closer ? allowed_tags_without_option : allowed_tags_with_option)[tag];

      if (closer || !config.followed_by || config.followed_by.exec(text.slice(match.index + match[0].length))) {
        result.push({
          type:    lmatch[2].toLowerCase(),
          param:   option,
          nesting: lmatch[1] ? -1 : 1,
          text:    match[0]
        });

        regexp.lastIndex = pos = match.index + match[0].length;
      }
    } else {
      add_text_node(result, '[');

      regexp.lastIndex = pos = match.index + 1;
    }
  }

  if (text.length !== pos) {
    add_text_node(result, text.slice(pos));
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
function add_inlines(tokens) {
  var regexp = get_joint_regexp();
  var result = [];

  tokens.forEach(function (token) {
    var match;
    var pos = 0;

    if (token.type === 'text') {
      regexp.lastIndex = 0;

      while ((match = regexp.exec(token.text))) {
        if (match.index !== pos) {
          add_text_node(result, token.text.slice(pos, match.index));
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

      if (token.text.length !== pos) {
        add_text_node(result, token.text.slice(pos));
      }
    } else {
      result.push(token);
    }
  });

  return result;
}


// Collapse series of text nodes into one,
// they could be split in previous steps, e.g. cleanup:
// ['text1', '[i]', '[/i]', 'text2'] -> ['text1', 'text2'] -> ['text1text2']
//
function join_text(tokens) {
  var out_tokens = [];

  for (var i = 0; i < tokens.length; i++) {
    if (tokens[i].type === 'text') {
      add_text_node(out_tokens, tokens[i].text);
    } else {
      out_tokens.push(tokens[i]);
    }
  }

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
  return add_inlines(join_text(cleanup(balance(balance_links(remove_unpaired(tokenize(text)))))));
};
