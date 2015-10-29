
'use strict';


var md = require('markdown-it')();


module.exports = function (tokens) {
  var result = '';

  tokens.forEach(function (token, i) {
    var prev, next;

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
          next = i < tokens.length ? tokens[i + 1] : {};
          result += (next.type !== 'text' || md.utils.isWhiteSpace(next.text.charCodeAt(0))) ?
                    '**' :
                    '**\u200A';
        }
        break;
      default:
        throw new Error('Unable to format token type: ' + token.type);
    }
  });

  return result;
};
