
'use strict';


var md = require('markdown-it')();


/* eslint-disable max-depth */
/* eslint-disable no-loop-func */
module.exports = function to_md(tokens) {
  var result = '';

  for (var i = 0; i < tokens.length; i++) {
    var prev, next, token = tokens[i];

    switch (token.type) {
      case 'text':
        result += token.text;
        break;
      case 'newline':
        result += '  \n';
        break;
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
      case 'quote':
        var j;

        for (j = i + 1; j < tokens.length; j++) {
          if (tokens[j] === token.peer) { break; }
        }

        if (j >= tokens.length) {
          throw new Error('Unable to find closing quote');
        }

        result += '\n\n';

        if (token.param) {
          var tmp = to_md(tokens.slice(i + 1, j)) + '\n';
          var grave_count = (tmp.match(/(?:^|\n)(`+)/g) || []).reduce(function (acc, str) {
            var len = str.replace(/[^`]/g, '').length;

            return Math.max(len, acc);
          }, 2);

          result += Array(grave_count + 2).join('`') + 'quote ' + token.param + '\n';
          result += to_md(tokens.slice(i + 1, j)) + '\n';
          result += Array(grave_count + 2).join('`') + '\n\n';
        } else {
          result += to_md(tokens.slice(i + 1, j)).replace(/(^|\n) ?/g, function (match, before) {
            return before + ' >';
          });
          result += '\n\n';
        }

        i = j;

        break;
      default:
        // throw new Error('Unable to format token type: ' + token.type);
    }
  }

  return result
           .replace(/^(\s*\n)+/, '')
           .replace(/(\s*\n){3,}/g, '\n\n');
};
