
'use strict';

/* eslint-disable max-depth */
/* eslint-disable no-loop-func */


var md      = require('markdown-it')();
var mdurl   = require('mdurl');
var to_text = require('./format_text');


// escape url inside markdown `<...>` tag
function escape_url(url) {
  return mdurl.encode(url);
}


// escape inline text
function escape_text(text) {
  return text.replace(/([#*<>\[\\\]_`~])/g, '\\$1');
}


// wrap all block-level markdown tags in paragraphs
function add_paragraphs(tokens) {
  var opener       = { type: 'paragraph', nesting: 1, text: '' };
  var out_tokens   = [ opener ];
  var inline_level = 0;
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

    var is_block_tag = (token.type === 'quote' || token.type === 'left' ||
                        token.type === 'right' || token.type === 'indent' ||
                        token.type === 'video');

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
  var result = '';

  for (var i = 0; i < tokens.length; i++) {
    var j, prev, next, token = tokens[i];

    switch (token.type) {
      case 'text':
        result += escape_text(token.text);
        break;
      case 'newline':
        result += '  \n';
        break;
      case 'underline':
      case 'em':
        if (token.nesting === 1) {
          prev = i ? tokens[i - 1] : {};
          result += (prev.type !== 'text' || md.utils.isWhiteSpace(prev.text.charCodeAt(prev.text.length - 1))) ?
                    '_' :
                    '\u200A_';
        } else {
          next = i + 1 < tokens.length ? tokens[i + 1] : {};
          result += (next.type !== 'text' || md.utils.isWhiteSpace(next.text.charCodeAt(0))) ?
                    '_' :
                    '_\u200A';
        }
        break;
      case 'strong':
        if (token.nesting === 1) {
          prev = i ? tokens[i - 1] : {};
          result += (prev.type !== 'text' || md.utils.isWhiteSpace(prev.text.charCodeAt(prev.text.length - 1))) ?
                    '**' :
                    '\u200A**';
        } else {
          next = i + 1 < tokens.length ? tokens[i + 1] : {};
          result += (next.type !== 'text' || md.utils.isWhiteSpace(next.text.charCodeAt(0))) ?
                    '**' :
                    '**\u200A';
        }
        break;
      case 'url':
        for (j = i + 1; j < tokens.length; j++) {
          if (tokens[j] === token.peer) { break; }
        }

        if (j >= tokens.length) {
          throw new Error('Unable to find closing url');
        }

        var contents = format_inlines(tokens.slice(i + 1, j));

        if ((token.param && token.param !== contents) || !contents.match(/^https?:\/\//)) {
          result += '[' + contents + '](' + escape_url(token.param || to_text(tokens.slice(i + 1, j))) + ')';
        } else {
          result += '<' + escape_url(to_text(tokens.slice(i + 1, j))) + '>';
        }

        i = j;

        break;
      case 'image':
        result += '![](<' + escape_url(token.param) + '>)';
        break;
      case 'video':
        result += escape_url(token.param);
        break;
      case 'attach':
        if (refs && refs.quotes && refs.attachments[token.param]) {
          result += '![](<' + escape_url(refs.attachments[token.param]) + '>)';
        } else {
          result += escape_text(token.text);
        }
        break;
      case 'smiley':
        // TODO
        result += ':)';
        break;
      case 'quote':
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
    var j, token = tokens[i];

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
            tokens[i + 2].type === 'strong' && tokens[i + 2].nesting === 1 &&
            tokens[i + 3].type === 'text' && tokens[i + 3].text.match(/ \(\d{2}-\d{2}-\d{4} \d{2}:\d{2}\):$/) &&
            tokens[i + 4].type === 'strong' && tokens[i + 4].nesting === -1 &&
            tokens[i + 5].type === 'newline') {

          token.param = tokens[i + 3].text.replace(/:$/, '');
          tokens.splice(i + 2, 4);
        }

        for (j = i + 1; j < tokens.length; j++) {
          if (tokens[j] === token.peer) { break; }
        }

        if (j >= tokens.length) {
          throw new Error('Unable to find closing quote');
        }

        if (token.replyto && refs && refs.quotes && refs.quotes[token.replyto[1]]) {
          result += refs.quotes[token.replyto[1]] + '\n';
          result += format_blocks(tokens.slice(i + 1, j)).replace(/(^|\n) ?/g, function (match, before) {
            return before + ' > ';
          });
        } else if (token.param) {
          var tmp = format_blocks(tokens.slice(i + 1, j)) + '\n';
          var grave_count = (tmp.match(/(?:^|\n)(`+)/g) || []).reduce(function (acc, str) {
            var len = str.replace(/[^`]/g, '').length;

            return Math.max(len, acc);
          }, 2);

          result += Array(grave_count + 2).join('`') + 'quote ' + token.param + '\n';
          result += format_blocks(tokens.slice(i + 1, j)) + '\n';
          result += Array(grave_count + 2).join('`');
        } else {
          result += format_blocks(tokens.slice(i + 1, j)).replace(/(^|\n) ?/g, function (match, before) {
            return before + ' > ';
          });
        }

        i = j;

        break;
      case 'video':
        result += escape_url(token.param);
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
          throw new Error('Unable to find closing paragraph');
        }

        result += format_inlines(tokens.slice(i + 1, j));

        i = j;

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
