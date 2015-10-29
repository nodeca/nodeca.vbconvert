
'use strict';


module.exports = function (tokens) {
  var result = '';

  tokens.forEach(function (token, i) {
    var prev, next;

    switch (token.type) {
      case 'text':
        result += token.text.replace(/"/g, '&quot;');
        break;
      case 'newline':
        prev = i ? tokens[i - 1] : {};
        next = i + 1 < tokens.length ? tokens[i + 1] : {};

        if (!((prev.type === 'quote' && prev.nesting === -1) || (next.type === 'quote' && next.nesting === -1))) {
          result += '<br />\n';
        }
        break;
      case 'em':
        result += token.nesting === 1 ? '<i>' : '</i>';
        break;
      case 'strong':
        result += token.nesting === 1 ? '<b>' : '</b>';
        break;
      case 'underline':
        result += token.nesting === 1 ? '<u>' : '</u>';
        break;
      case 'quote':
        if (token.replyto) {
          result += '<div class="bbcode_container">\n\t<div class="bbcode_quote">\n' +
                    '\t\t<div class="quote_container">\n' +
                    '\t\t\t<div class="bbcode_quote_container"></div>\n\t\t\t\n' +
                    '\t\t\t\t<div class="bbcode_postedby">\n' +
                    '\t\t\t\t\t<img src="images/misc/quote_icon.png" alt="Цитата" /> Сообщение от <strong>' +
                    token.replyto[0] + '</strong>\n' +
                    '\t\t\t\t\t<a href="showthread.php?p=' + token.replyto[1] + '#post' + token.replyto[1] + '" ' +
                    'rel="nofollow"><img class="inlineimg" src="images/buttons/viewpost-right.png" ' +
                    'alt="Посмотреть сообщение" /></a>\n' +
                    '\t\t\t\t</div>\n' +
                    '\t\t\t\t<div class="message">';
        } else if (token.nesting === -1) {
          result = result.replace(/\s+$/, '');
          result += '</div>\n\t\t\t\n\t\t</div>\n\t</div>\n</div> ';
        }
        break;
      case 'smiley':
        result += '<img src="images/smilies/' + token.name + '.gif" ' +
                  'border="0" alt="" title="' + token.text + '" class="inlineimg" />';
        break;
      default:
        throw new Error('Unable to format token type: ' + token.type);
    }
  });

  return result;
};
