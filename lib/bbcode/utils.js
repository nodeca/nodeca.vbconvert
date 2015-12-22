
'use strict';

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
function remove_empty(tokens) {
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


// Add text node to a token list
//
function add_text_node(tokens, text) {
  if (tokens.length && tokens[tokens.length - 1].type === 'text') {
    tokens[tokens.length - 1].text += text;
  } else {
    tokens.push({ type: 'text', text: text });
  }
}


module.exports.cleanup = function (tokens) {
  return join_text(remove_empty(tokens));
};

module.exports.add_text_node = add_text_node;
