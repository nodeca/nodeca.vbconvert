
'use strict';

/* eslint-disable max-depth */
/* eslint-disable no-loop-func */


var _       = require('lodash');
var md      = require('markdown-it')();
var mdurl   = require('mdurl');
var cleanup = require('./utils').cleanup;

var isWhiteSpace   = md.utils.isWhiteSpace;
var isPunctChar    = md.utils.isPunctChar;
var isMdAsciiPunct = md.utils.isMdAsciiPunct;

// url validation function from markdown-it
//
var BAD_PROTO_RE = /^(vbscript|javascript|file|data):/;
var GOOD_DATA_RE = /^data:image\/(gif|png|jpeg|webp);/;

function validateLink(url) {
  // url should be normalized at this point, and existing entities are decoded
  var str = url.trim().toLowerCase();

  return BAD_PROTO_RE.test(str) ? (GOOD_DATA_RE.test(str) ? true : false) : true;
}

// get token original text
function to_text(tokens) {
  var result = '';

  for (var i = 0; i < tokens.length; i++) {
    if (tokens[i].type === 'text' || tokens[i].type === 'text-link') {
      result += tokens[i].text;
    }
  }

  return result;
}


function is_block_tag_type(token_type) {
  return token_type === 'left'  || token_type === 'center' ||
         token_type === 'right' || token_type === 'indent' ||
         token_type === 'video' || token_type === 'list' ||
         token_type === 'more'  || token_type === 'spoiler' ||
         token_type === 'code'  || token_type === 'paragraph' ||
         token_type === 'quote';
}


// escape url inside markdown `<...>` tag
function escape_url(url) {
  // escape (), don't escape []
  return mdurl.encode(url, ';/?:@&=+$,-_.!~*\'#[]');
}


// escape inline text
function escape_text(text) {
  // _* - emphasis
  // \  - escape
  // `  - code
  // ~  - strikeout, sub
  // ^  - sup
  // &  - entity
  return text.replace(/([_*\\`~^&])/g, '\\$1')

             // replace possible autolinks
             .replace(/(<)(?=[^\s]+>|$)/g, '\\$1')

             // replace possible links/references,
             // note that this regexp will fail if [ and ] are separated into
             // two different text nodes, e.g. [[b]foo[/b]]()
             .replace(/(\[)(?=.*\](?:[:(]))/g, '\\$1');
}


// Escape all block-level tags
//
// NOTE: text is a formatted markdown line, so inline tags must not be escaped here
//
function escape_block(text) {
  return text

    // prevent false-positive on lists, e.g.
    // http://dev.rcopen.com/forum/f91/topic288047/24
    // .replace(/^(\s*\d+)([\.)])/mg, '$1\\$2')

    // replace empty standalone list items, e.g.:
    // http://forum.rcdesign.ru/blogs/192479/blog22893.html
    .replace(/^(\s*)([-+*])(\s*)$/mg, '$1\\$2$3')

    // prevent unintended code blocks
    .replace(/^(\t|\s{4})\s*/mg, ' ')

    // horizontal rules - [*_-]
    // we escape first punct character if the second one is the same
    .replace(/^(\s*)(([*_-])\s*(\3\s*)+)$/mg, '$1\\$2')

    // setext headers [=-]
    .replace(/^(\s*)((=+|-+)\s*)$/mg, '$1\\$2')

    // atx headers, quotes
    .replace(/^(\s*)([#>])/mg, '$1\\$2');
}


// Find any blocks inside inline elements, and swap them so inline elements
// would be inside blocks, for example:
//
// [b]foo[quote]bar[/quote][/b] -> [b]foo[/b][quote][b]bar[/b][/quote]
//
function bubble_up_blocks(tokens) {
  var list_level     = 0;
  var opened_inlines = [];
  var out_tokens     = [];
  var j;

  for (var i = 0; i < tokens.length; i++) {
    var token = tokens[i];
    var is_block_tag = is_block_tag_type(token.type) ||
                       (token.type === 'list_item' && list_level > 0);

    // track list level 'cause list_item may only be such inside list tags
    if (token.type === 'list') {
      list_level += token.nesting;
    }

    if (is_block_tag) {
      // Process block tag
      //
      for (j = opened_inlines.length - 1; j >= 0; j--) {
        out_tokens.push(_.assign({}, opened_inlines[j], { nesting: -1 }));
      }

      out_tokens.push(token);

      for (j = 0; j < opened_inlines.length; j++) {
        out_tokens.push(_.assign({}, opened_inlines[j]));
      }
    } else {
      // Process inline tag
      //
      out_tokens.push(token);

      if (token.nesting === 1) {
        opened_inlines.push(token);
      } else if (token.nesting === -1) {
        opened_inlines.pop();
      }
    }
  }

  return out_tokens;
}


// Cut spaces from a part of a text token
//
function cut_spaces(token, is_end) {
  var spaces = null;

  token.text = token.text.replace(is_end ? /[ \t]+$/ : /^[ \t]+/, function (m) {
    spaces = m;
    return '';
  });

  if (spaces) {
    return { type: 'text', text: spaces };
  }
}


// Shift emphasis tag position, so emphases will be directly adjacent
// to actual text, e.g.:
//
// `foo[i] bar[/i]` -> `foo [i]bar[/i]`
//
// It's needed to render markdown without using any ZWSP quirks
//
function shift_emphasis(tokens) {
  var last_non_em_pos = -1;
  var last_em_nesting = 0; // -1, 1 if last tag is em, 0 otherwise
  var new_token;

  for (var i = 0; i < tokens.length + 1; i++) {
    // looping through all tokens plus an imaginary token at the end
    // (makes some code easier)
    var token = tokens[i] || { type: 'bogus_ending_token' };

    if (token.type === 'i' || token.type === 'b' ||
        token.type === 's' || token.type === 'u') {

      if (last_em_nesting !== token.nesting &&
          last_non_em_pos >= 0 &&
          tokens[last_non_em_pos].type === 'text') {
        //
        // [ `foo `, `[/i]`, `[i]` ]
        //                   ^^^^^-- current tag
        //
        // transformed into:
        //
        // [ `foo`, `[/i]`, ` `, `[i]` ]
        //

        new_token = cut_spaces(tokens[last_non_em_pos], true);

        if (new_token) {
          tokens.splice(i, 0, new_token);
          last_non_em_pos++;
          i++;
        }
      }

      last_em_nesting = token.nesting;
    } else {
      if (last_em_nesting === 1 &&
          token.type === 'text') {
        //
        // [ `foo`, `[i]`, ` bar` ] -> [ `foo`, ` `, `[i]`, `bar` ]
        //

        new_token = cut_spaces(token, false);

        if (new_token) {
          tokens.splice(last_non_em_pos + 1, 0, new_token);
          i++;
        }
      } else if (last_em_nesting === -1 &&
                 last_non_em_pos >= 0 &&
                 tokens[last_non_em_pos].type === 'text') {
        //
        // [ `foo `, `[/i]`, `bar` ] -> [ `foo`, `[/i]`, ` `, `bar` ]
        //

        new_token = cut_spaces(tokens[last_non_em_pos], true);

        if (new_token) {
          tokens.splice(i, 0, new_token);
          i++;
        }
      }

      last_non_em_pos = i;
      last_em_nesting = 0;
    }
  }

  return tokens;
}


// Wrap all block-level markdown tags in paragraphs
//
// NOTE: this will break inline tags, e.g.:
//       <b>text\n\ntext</b> -> <p><b>text</p><p>text</b>
//       but it'll be auto-fixed in "bubbling up" step later
//
function add_paragraphs(tokens) {
  var opener       = { type: 'paragraph', nesting: 1, text: '' };
  var out_tokens   = [ opener ];
  var list_level   = 0;
  var code_level   = 0;
  var closer;

  for (var i = 0; i < tokens.length; i++) {
    var token = tokens[i];

    // trim spaces before newlines, e.g. 'test   \n' -> 'test\n'
    if (token.type === 'newline' && out_tokens.length &&
        out_tokens[out_tokens.length - 1].type === 'text') {

      out_tokens[out_tokens.length - 1].text = out_tokens[out_tokens.length - 1].text.replace(/\s+$/, '');

      if (!out_tokens[out_tokens.length - 1].text.length) {
        out_tokens.pop();
      }
    }

    var is_block_tag = is_block_tag_type(token.type) ||
                       (token.type === 'list_item' && list_level > 0);

    if (token.type === 'code') {
      code_level += token.nesting;
    }

    if (token.type === 'list') {
      list_level += token.nesting;
    }

    if (token.type === 'newline' &&
        out_tokens.length &&
        out_tokens[out_tokens.length - 1].type === 'newline' &&
        !code_level) {

      is_block_tag = true;
      out_tokens.pop();
    }

    if (is_block_tag) {
      if (out_tokens.length && out_tokens[out_tokens.length - 1].type === 'paragraph') {
        out_tokens.pop();
      } else {
        closer = { type: 'paragraph', nesting: -1, text: '' };
        closer.peer = opener;
        opener.peer = closer;
        out_tokens.push(closer);
      }
    }

    if (token.type === 'newline' && !code_level) {
      // only insert newline if it's inside paragraph,
      // ignoring sequences of newlines
      if (!is_block_tag && out_tokens[out_tokens.length - 1].type !== 'paragraph') {
        out_tokens.push(token);
      }
    } else {
      out_tokens.push(token);
    }

    if (is_block_tag) {
      opener = { type: 'paragraph', nesting: 1, text: '' };
      out_tokens.push(opener);
    }
  }

  if (out_tokens.length && out_tokens[out_tokens.length - 1].type === 'paragraph') {
    out_tokens.pop();
  } else {
    closer = { type: 'paragraph', nesting: -1, text: '' };
    closer.peer = opener;
    opener.peer = closer;
    out_tokens.push(closer);
  }

  return out_tokens;
}


// Determine if token[i] could close an emphasis or open one, large chunk
// of this code is borrowed from markdown-it StateInline#scanDelims function
//
function scan_delims(tokens, i) {
  var lastChar, nextChar, isLastPunctChar, isNextPunctChar, isLastWhiteSpace,
      isNextWhiteSpace, left_flanking, right_flanking, can_open, can_close;

  var prev      = tokens[i - 1] || {};
  var next      = tokens[i + 1] || {};

  if (prev.type === 'text') {
    lastChar = prev.text.charCodeAt(prev.text.length - 1);
  } else if (prev.type === 'newline' || prev.type === 'paragraph' || !prev.type) {
    lastChar = 0x20; // space
  } else {
    lastChar = 0x2A; // punct
  }

  if (next.type === 'text') {
    nextChar = next.text.charCodeAt(0);
  } else if (next.type === 'newline' || next.type === 'paragraph' || !next.type) {
    nextChar = 0x20; // space
  } else {
    nextChar = 0x2A; // punct
  }

  isLastPunctChar = isMdAsciiPunct(lastChar) || isPunctChar(String.fromCharCode(lastChar));
  isNextPunctChar = isMdAsciiPunct(nextChar) || isPunctChar(String.fromCharCode(nextChar));

  isLastWhiteSpace = isWhiteSpace(lastChar);
  isNextWhiteSpace = isWhiteSpace(nextChar);

  if (isNextWhiteSpace) {
    left_flanking = false;
  } else if (isNextPunctChar) {
    if (!(isLastWhiteSpace || isLastPunctChar)) {
      left_flanking = false;
    }
  }

  if (isLastWhiteSpace) {
    right_flanking = false;
  } else if (isLastPunctChar) {
    if (!(isNextWhiteSpace || isNextPunctChar)) {
      right_flanking = false;
    }
  }

  can_open  = left_flanking  && (!right_flanking || isLastPunctChar);
  can_close = right_flanking && (!left_flanking  || isNextPunctChar);

  return {
    can_open,
    can_close,
    last_space:  isLastWhiteSpace,
    next_space:  isNextWhiteSpace,
    last_letter: !(isLastWhiteSpace || isLastPunctChar),
    next_letter: !(isNextWhiteSpace || isNextPunctChar)
  };
}


function format_inlines(tokens, refs) {
  var result = '', j, contents, mapped_link;
  var map_link = refs && refs.link_replacer ? refs.link_replacer : u => u;

  for (var i = 0; i < tokens.length; i++) {
    var token = tokens[i];

    switch (token.type) {
      case 'text':
        result += escape_text(token.text);
        break;
      case 'text-link':
        // plain-text link without url tags
        mapped_link = map_link(token.param, false);

        if (token.nested) {
          result += escape_text(mapped_link);
        } else if (mapped_link === token.param || !mapped_link) {
          result += escape_text(token.text);
        } else if (mapped_link.match(/^https?:|^mailto:/)) {
          result += '<' + escape_url(mapped_link) + '>';
        } else {
          result += '[' + escape_text(mapped_link) + '](' + escape_url(mapped_link) + ')';
        }

        break;
      case 'newline':
        result += '  \n';
        break;
      case 'sub':
      case 'sup':
        for (j = i + 1; j < tokens.length; j++) {
          if (tokens[j] === token.peer) break;
        }

        if (j >= tokens.length) {
          throw new Error('Unable to find closing tag');
        }

        result += token.type === 'sub' ? '~' : '^';
        result += to_text(tokens.slice(i + 1, j)).replace(/ /g, '\\ ');
        result += token.type === 'sub' ? '~' : '^';

        i = j;
        break;
      case 'u':
      case 'i':
      case 'b':
      case 's':
      case 'highlight':
        //
        // Quick diagram of emphasis rules for "_":
        //
        //           space  punct  letter
        //    space    --     op     op
        //    punct    cl    op,cl   op
        //    letter   cl     cl     --
        //
        // So a code below is based on a fact that:
        //
        //  - U+200A (HAIR SPACE) is considered a space (unicode class Z)
        //  - U+200B (ZWSP) is not considered a space (unicode class Cf)
        //
        // We add one or the other to resolve any ambiguity that might happen.
        //
        var marker;

        if (token.type === 'b' || token.type === 'highlight') {
          marker = '**';
        } else if (token.type === 's') {
          marker = '~~';
        } else {
          marker = '_';
        }

        var delims = scan_delims(tokens, i);

        // disabling eslint rules 'cause they make code harder to understand
        /* eslint-disable operator-assignment */
        /* eslint-disable no-lonely-if */
        if (token.nesting === 1) {
          if (!delims.can_open) {
            // space  + marker + space  -> space + marker + ZWSP
            // punct  + marker + space  -> punct + marker + ZWSP
            // letter + marker + space  -> HAIR  + marker + ZWSP
            // letter + marker + punct  -> HAIR  + marker + punct
            // letter + marker + letter -> HAIR  + marker + letter
            if (delims.last_letter) { marker = '\u200A' + marker; }
            if (delims.next_space)  { marker = marker + '\u200B'; }
          }
        } else {
          if (!delims.can_close) {
            if (delims.next_letter) { marker = marker + '\u200A'; }
            if (delims.last_space)  { marker = '\u200B' + marker; }
          }
        }

        result += marker;
        break;
      case 'url':
      case 'email':
        for (j = i + 1; j < tokens.length; j++) {
          if (tokens[j] === token.peer) break;
        }

        if (j >= tokens.length) {
          throw new Error('Unable to find closing tag');
        }

        var raw = to_text(tokens.slice(i + 1, j)).trim();
        var prefix;

        contents = format_inlines(tokens.slice(i + 1, j), refs);

        if (contents.match(/^\s*$/) || !validateLink(token.param || raw)) {
          // skip empty links
          result += contents;
        } else if (token.type === 'email' &&
            !(token.param || raw).match(/^[a-z0-9.!\#$%&\'*+-/=?^_`{|}~]+@([0-9.]+|([^\s\'"<>@,;]+\.+[a-z]{2,6}))$/)) {
          // If email is not a valid one, leave it as plaintext,
          // validation regexp is similar to one used in vB
          //
          result += contents;
        } else if (token.type === 'url' &&
          (token.param || raw).match(/^([a-z0-9]+:\/\/)?[^\/]*\*/i)) {
          // If there is an asterisk in the domain name
          // (i.e. "*" before any "/", protocol excluded),
          // this is likely a banned url, so leave it as it was
          //
          result += contents;
        } else {
          if (token.type === 'email') {
            prefix = 'mailto:';
          } else if ((token.param || raw).match(/^[a-z0-9]+:/i)) {
            prefix = '';
          } else {
            prefix = 'http://';
          }

          let is_autolink = false;

          if (token.param) {
            let m, content = raw.trim();

            if (token.param === content) {
              is_autolink = true;
            } else if ((m = content.match(/^(.+)\.\.\.(.+)$/))) {
              // [url=http://example.com/foobarbaz]http://example.com/f...az[/url]
              if (token.param.slice(0, m[1].length) === m[1] && token.param.slice(-m[2].length) === m[2]) {
                if (m[1].length + m[2].length < token.param.length) {
                  is_autolink = true;
                }
              }
            }
          } else {
            is_autolink = true;
          }

          if (!is_autolink) {
            // Create regular markdown link like [description](url) if bbcode tag
            // contains a param not equal to what's inside,
            // i.e. [url="http://foo"]http://bar[/url], but not [url="http://foo"]http://foo[/url]
            //

            result += '[' + contents + '](' +
                        prefix +
                        escape_url(map_link(token.param || raw, false)) +
                      ')';
          } else {
            if (token.type === 'email') {
              prefix = 'mailto:';
            } else if ((token.param || raw).match(/^[a-z0-9]+:/i)) {
              prefix = '';
            } else {
              prefix = 'http://';
            }

            mapped_link = map_link(prefix + (token.param || raw), false);

            if (mapped_link.match(/^https?:|^mailto:/)) {
              // Replace [url]...[/url] with autolinks if it'll be a correct autolink afterwards;
              // NOTE: mapped link can fail this if we use protocol-relative urls
              //
              // We can convert it to text links instead for linkifier to process, but:
              //
              //  1. they can intermix with other content, e.g. `[url]http://foo[/url]bar`
              //     (maybe add leading/trailing space in this case?)
              //
              //  2. they can be expanded into block snippets
              //
              result += '<' + escape_url(mapped_link) + '>';
            } else {
              // Unfortunate case when the link can't be an autolink, so it won't be shortened
              //
              result += '[' + escape_text(mapped_link) + '](' + escape_url(mapped_link) + ')';
            }
          }
        }

        i = j;

        break;
      case 'thread':
      case 'post':
        for (j = i + 1; j < tokens.length; j++) {
          if (tokens[j] === token.peer) break;
        }

        if (j >= tokens.length) {
          throw new Error('Unable to find closing tag');
        }

        var dict = (refs || {})[token.type === 'thread' ? 'topics' : 'posts'];

        contents = format_inlines(tokens.slice(i + 1, j), refs);

        if (token.param) {
          if (!dict || !dict[token.param]) {
            result += contents;
          } else {
            result += '[' + contents + '](' + escape_url(map_link(dict[token.param], false)) + ')';
          }
        } else {
          /* eslint-disable no-lonely-if */
          if (!dict || !dict[contents]) {
            result += contents;
          } else {
            result += escape_url(map_link(dict[contents], false));
          }
        }

        i = j;

        break;
      case 'image':
        result += '![' + escape_text(token.alt || '') + '](' + escape_url(map_link(token.param, true)) + ')';
        break;
      case 'video':
        for (j = i + 1; j < tokens.length; j++) {
          if (tokens[j] === token.peer) break;
        }

        if (j >= tokens.length) {
          throw new Error('Unable to find closing tag');
        }

        result += escape_url(map_link(to_text(tokens.slice(i + 1, j)), false));

        i = j;
        break;
      case 'attach':
        if (refs && refs.attachments && refs.attachments[token.param]) {
          result += '![](' + escape_url(map_link(refs.attachments[token.param], true)) + ')';
        } else {
          throw new Error('No source found for attachment');
        }
        break;
      case 'smiley':
        result += token.mapping;
        break;
      case 'list_item':
        // list item without a list
        result += escape_text(token.text);
        break;
      case 'font':
      case 'size':
      case 'color':
      case 'qr':
        // ignore those
        break;
      case 'more':
        // ignore [more] tag, we have no equivalent for it in md
        break;
      case 'html':
      case 'php':
      case 'noparse':
        // ignore, because they don't exist in real posts
        break;
      default:
        throw new Error('Unable to format token type: ' + token.type);
    }
  }

  return escape_block(result);
}


function format_blocks(tokens, refs) {
  var result = '';
  var prev_result = ''; // only used to calculate if blocks are added
  var map_link = refs && refs.link_replacer ? refs.link_replacer : u => u;

  for (var i = 0; i < tokens.length; i++) {
    var j, token = tokens[i], tmp;

    if (result !== prev_result) {
      // add spacing between blocks
      result += '\n\n';
      prev_result = result;
    }

    switch (token.type) {
      case 'quote':
        // support for old quotes like [quote][b]test (12-12-2000 12:34):[/b],
        // see http://forum.rcdesign.ru/f36/thread200.html#post1175
        if (i + 5 < tokens.length &&
            tokens[i + 1].type === 'paragraph' && tokens[i + 1].nesting === 1 &&
            tokens[i + 2].type === 'b' && tokens[i + 2].nesting === 1 &&
            tokens[i + 3].type === 'text' && tokens[i + 3].text.match(/ \(\d{2}-\d{2}-\d{4} \d{2}:\d{2}\):$/) &&
            tokens[i + 4].type === 'b' && tokens[i + 4].nesting === -1 &&
            tokens[i + 5].type === 'newline') {

          token.param = tokens[i + 3].text.replace(/:$/, '');
          tokens.splice(i + 2, 4);
        }

        for (j = i + 1; j < tokens.length; j++) {
          if (tokens[j] === token.peer) break;
        }

        if (j >= tokens.length) {
          throw new Error('Unable to find closing tag');
        }

        let link = token.param && refs && refs.quote_param_to_link && refs.quote_param_to_link(token.param);

        if (link) {
          result += link + '\n';
          result += format_blocks(tokens.slice(i + 1, j), refs).replace(/(^|\n) ?/g, function (match, before) {
            return before + '> ';
          }).replace(/\n+$/g, '');
        } else if (token.param) {
          tmp = format_blocks(tokens.slice(i + 1, j), refs) + '\n';

          var grave_count = (tmp.match(/(?:^|\n)(`+)/g) || []).reduce(function (acc, str) {
            var len = str.replace(/[^`]/g, '').length;

            return Math.max(len, acc);
          }, 2);

          result += Array(grave_count + 2).join('`') + 'quote ' + token.param + '\n';
          result += tmp;
          result += Array(grave_count + 2).join('`');
        } else {
          result += format_blocks(tokens.slice(i + 1, j), refs).replace(/(^|\n) ?/g, function (match, before) {
            return before + '> ';
          }).replace(/\n+$/g, '');
        }

        i = j;

        break;
      case 'spoiler':
        for (j = i + 1; j < tokens.length; j++) {
          if (tokens[j] === token.peer) break;
        }

        if (j >= tokens.length) {
          throw new Error('Unable to find closing tag');
        }

        tmp = format_blocks(tokens.slice(i + 1, j), refs) + '\n';

        var sp_grave_count = (tmp.match(/(?:^|\n)(`+)/g) || []).reduce(function (acc, str) {
          var len = str.replace(/[^`]/g, '').length;

          return Math.max(len, acc);
        }, 2);

        result += Array(sp_grave_count + 2).join('`') + 'spoiler';
        result += (token.param ? ' ' + token.param : '') + '\n';
        result += tmp;
        result += Array(sp_grave_count + 2).join('`');

        i = j;

        break;
      case 'code':
        var text = '';

        for (j = i + 1; j < tokens.length; j++) {
          if (tokens[j].type === 'text' || tokens[j].type === 'newline') {
            text += tokens[j].text;
          }

          if (tokens[j] === token.peer) break;
        }

        if (j >= tokens.length) {
          throw new Error('Unable to find closing tag');
        }

        result += '```\n';
        result += text.replace(/^\n{1,2}|\n+$/g, '') + '\n';
        result += '```';

        i = j;

        break;
      case 'video':
        for (j = i + 1; j < tokens.length; j++) {
          if (tokens[j] === token.peer) break;
        }

        if (j >= tokens.length) {
          throw new Error('Unable to find closing tag');
        }

        result += escape_url(map_link(to_text(tokens.slice(i + 1, j)), false));

        i = j;
        break;
      case 'list':
        var items = [];
        var current = [];
        var counter = 0;
        var nesting = 0;

        for (j = i + 1; j < tokens.length; j++) {
          if (tokens[j] === token.peer) break;

          if (nesting === 0 && tokens[j].type === 'list_item') {
            if (current.length) { items.push(current); }

            current = [];
          } else {
            if (is_block_tag_type(tokens[j].type)) {
              nesting += tokens[j].nesting || 0;
            }

            current.push(tokens[j]);
          }
        }

        if (current.length) { items.push(current); }

        if (j >= tokens.length) {
          throw new Error('Unable to find closing tag');
        }

        i = j;

        let li_prev_result = result;

        for (j = 0; j < items.length; j++) {
          tmp = format_blocks(items[j], refs).replace(/\n+$/g, '');

          if (result !== li_prev_result) {
            // add spacing between list items
            result += '\n';
            li_prev_result = result;
          }

          if (tmp.length) {
            counter++;

            if (typeof token.param !== 'undefined' && token.param !== null) {
              result += _.padEnd(counter + '.', String(items.length).length + 2) +
                        tmp.replace(/\n/g, '\n' + _.repeat(' ', String(items.length).length + 2));
            } else {
              result += '- ' + tmp.replace(/\n/g, '\n  ');
            }
          }
        }

        break;
      case 'list_item':
        // list item without a list
        result += escape_text(token.text);
        break;
      case 'left':
      case 'center':
      case 'right':
      case 'indent':
        for (j = i + 1; j < tokens.length; j++) {
          if (tokens[j] === token.peer) break;
        }

        if (j >= tokens.length) {
          throw new Error('Unable to find closing tag');
        }

        result += format_blocks(tokens.slice(i + 1, j), refs).trim();

        i = j;

        break;
      case 'paragraph':
        for (j = i + 1; j < tokens.length; j++) {
          if (tokens[j] === token.peer) break;
        }

        if (j >= tokens.length) {
          throw new Error('Unable to find closing tag');
        }

        result += format_inlines(tokens.slice(i + 1, j), refs).trim();

        i = j;

        break;
      case 'more':
        // ignore [more] tag, we have no equivalent for it in md
        break;
      default:
        throw new Error('Unable to format token type: ' + token.type);
    }
  }

  return result.replace(/\n+$/, '\n');
}


module.exports = function to_md(tokens, refs) {
  tokens = add_paragraphs(tokens);
  tokens = bubble_up_blocks(tokens);
  tokens = shift_emphasis(tokens);
  tokens = cleanup(tokens);

  return format_blocks(tokens, refs);
};
