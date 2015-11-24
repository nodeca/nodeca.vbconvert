
'use strict';

/* eslint-disable max-depth */
/* eslint-disable no-loop-func */


var _       = require('lodash');
var md      = require('markdown-it')();
var mdurl   = require('mdurl');
var to_text = require('./format_text');


// escape url inside markdown `<...>` tag
function escape_url(url) {
  // escape (), don't escape []
  return mdurl.encode(url, ';/?:@&=+$,-_.!~*\'#[]');
}


// escape inline text
function escape_text(text) {
  // #  - headers
  // _* - emphasis, horizontal line
  // <> - autolinks, quotes
  // [] - links
  // \  - escape
  // `  - code
  // ~  - strikeout, sub, fence
  // ^  - sup
  // &  - entity
  // -  - horizontal line
  return text.replace(/([#*<>\[\\\]_`~^&-])/g, '\\$1')

             // prevent false-positive on lists, e.g.
             // http://dev.rcopen.com/forum/f91/topic288047/24
             .replace(/(\d+)\./g, '$1\\.')

             // prevent unintended code blocks
             .replace(/[\s\t]+/, ' ');
}


// wrap all block-level markdown tags in paragraphs
function add_paragraphs(tokens) {
  var opener       = { type: 'paragraph', nesting: 1, text: '' };
  var out_tokens   = [ opener ];
  var inline_level = 0;
  var closer;
  var list_level = 0;

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

    var is_block_tag = (token.type === 'quote' || token.type === 'left' ||
                        token.type === 'right' || token.type === 'indent' ||
                        token.type === 'video' || token.type === 'list' ||
                        token.type === 'more'  || token.type === 'spoiler' ||
                        (token.type === 'list_item' && list_level > 0));

    if (token.type === 'list') {
      list_level += token.nesting;
    }

    if (token.type === 'newline' &&
        out_tokens.length &&
        out_tokens[out_tokens.length - 1].type === 'newline') {

      is_block_tag = true;
      out_tokens.pop();
    }

    if (inline_level > 0) {
      is_block_tag = false;
    }

    if (!is_block_tag) {
      inline_level += token.nesting || 0;
    }

    if (is_block_tag) {
      if (out_tokens[out_tokens.length - 1].type === 'paragraph' === out_tokens.length - 1) {
        out_tokens.pop();
      } else {
        closer = { type: 'paragraph', nesting: -1, text: '' };
        closer.peer = opener;
        opener.peer = closer;
        out_tokens.push(closer);
      }
    }

    if (token.type === 'newline') {
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

  if (out_tokens[out_tokens.length - 1].type === 'paragraph' === out_tokens.length - 1) {
    out_tokens.length.pop();
  } else {
    closer = { type: 'paragraph', nesting: -1, text: '' };
    closer.peer = opener;
    opener.peer = closer;
    out_tokens.push(closer);
  }

  return out_tokens;
}


function format_inlines(tokens, refs) {
  var result = '', j, prev, next, contents;

  for (var i = 0; i < tokens.length; i++) {
    var token = tokens[i];

    switch (token.type) {
      case 'text':
        result += escape_text(token.text);
        break;
      case 'newline':
        result += '  \n';
        break;
      case 'sub':
      case 'sup':
        for (j = i + 1; j < tokens.length; j++) {
          if (tokens[j] === token.peer) { break; }
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
        var marker;

        if (token.type === 'b' || token.type === 'highlight') {
          marker = '**';
        } else if (token.type === 's') {
          marker = '~~';
        } else {
          marker = '_';
        }

        if (token.nesting === 1) {
          prev = i ? tokens[i - 1] : {};
          result += (prev.type !== 'text' || md.utils.isWhiteSpace(prev.text.charCodeAt(prev.text.length - 1))) ?
                    marker :
                    '\u200A' + marker;
        } else {
          next = i + 1 < tokens.length ? tokens[i + 1] : {};
          result += (next.type !== 'text' || md.utils.isWhiteSpace(next.text.charCodeAt(0))) ?
                    marker :
                    marker + '\u200A';
        }
        break;
      case 'url':
      case 'email':
        for (j = i + 1; j < tokens.length; j++) {
          if (tokens[j] === token.peer) { break; }
        }

        if (j >= tokens.length) {
          throw new Error('Unable to find closing tag');
        }

        var raw = to_text(tokens.slice(i + 1, j)).trim();

        contents = format_inlines(tokens.slice(i + 1, j), refs);

        if (token.type === 'email' &&
            !(token.param || raw).match(/^[a-z0-9.!\#$%&\'*+-/=?^_`{|}~]+@([0-9.]+|([^\s\'"<>@,;]+\.+[a-z]{2,6}))$/)) {
          result += contents;
        } else if (token.param && token.param !== contents.trim()) {
          var prefix;

          if (token.type === 'email') {
            prefix = 'mailto:';
          } else if ((token.param || raw).match(/^[a-z0-9]+:/i)) {
            prefix = '';
          } else {
            prefix = 'http://';
          }

          result += '[' + contents + '](' +
                      prefix +
                      escape_url(token.param || raw) +
                    ')';
        } else {
          result += '<' + (token.type === 'email' ? 'mailto:' : '') + escape_url(raw) + '>';
        }

        i = j;

        break;
      case 'thread':
      case 'post':
        for (j = i + 1; j < tokens.length; j++) {
          if (tokens[j] === token.peer) { break; }
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
            result += '[' + contents + '](' + escape_url(dict[token.param]) + ')';
          }
        } else {
          /* eslint-disable no-lonely-if */
          if (!dict || !dict[contents]) {
            result += contents;
          } else {
            result += escape_url(dict[contents]);
          }
        }

        i = j;

        break;
      case 'image':
        result += '![](' + escape_url(token.param) + ')';
        break;
      case 'video':
        for (j = i + 1; j < tokens.length; j++) {
          if (tokens[j] === token.peer) { break; }
        }

        if (j >= tokens.length) {
          throw new Error('Unable to find closing tag');
        }

        result += escape_url(to_text(tokens.slice(i + 1, j)));

        i = j;
        break;
      case 'attach':
        if (refs && refs.attachments && refs.attachments[token.param]) {
          result += '![](' + escape_url(refs.attachments[token.param]) + ')';
        } else {
          result += '[Вложение ' + token.param + '](<#>)';
        }
        break;
      case 'smiley':
        // TODO
        result += ':)';
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
      /*case 'quote':
      case 'spoiler':
      case 'list':*/
      case 'left':
      case 'center':
      case 'right':
      case 'indent':
      case 'paragraph':
        // block tags inside inline tags, ignore for now
        break;
      default:
        throw new Error('Unable to format token type: ' + token.type);
    }
  }

  return result;
}


function format_blocks(tokens, refs) {
  var result = '';

  for (var i = 0; i < tokens.length; i++) {
    var j, token = tokens[i], tmp;

    if (result) {
      // add spacing between blocks
      result += '\n\n';
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
          if (tokens[j] === token.peer) { break; }
        }

        if (j >= tokens.length) {
          throw new Error('Unable to find closing tag');
        }

        var replyto = (token.param || '').match(/^\s*(.*)\s*;\s*(\d+)\s*$/);

        if (replyto && refs && refs.posts && refs.posts[replyto[2]]) {
          result += refs.posts[replyto[2]] + '\n';
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
          if (tokens[j] === token.peer) { break; }
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
      case 'video':
        for (j = i + 1; j < tokens.length; j++) {
          if (tokens[j] === token.peer) { break; }
        }

        if (j >= tokens.length) {
          throw new Error('Unable to find closing tag');
        }

        result += escape_url(to_text(tokens.slice(i + 1, j)));

        i = j;
        break;
      case 'list':
        var items = [];
        var current = [];
        var counter = 0;
        var nesting = 0;

        for (j = i + 1; j < tokens.length; j++) {
          if (tokens[j] === token.peer) { break; }

          if (nesting === 0 && tokens[j].type === 'list_item') {
            if (current.length) { items.push(current); }

            current = [];
          } else {
            if (tokens[j].type === 'list') {
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

        for (j = 0; j < items.length; j++) {
          tmp = format_blocks(items[j], refs).replace(/\n+$/g, '');

          if (j) { result += '\n'; }

          if (tmp.length) {
            counter++;

            if (typeof token.param !== 'undefined' && token.param !== null) {
              result += _.padRight(counter + '.', String(items.length).length + 2) +
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
      case 'paragraph':
        for (j = i + 1; j < tokens.length; j++) {
          if (tokens[j] === token.peer) { break; }
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
  return format_blocks(add_paragraphs(tokens), refs);
};
