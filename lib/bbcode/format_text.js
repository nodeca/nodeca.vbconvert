
'use strict';


module.exports = function to_text(tokens) {
  var result = '';

  for (var i = 0; i < tokens.length; i++) {
    result += tokens[i].text;
  }

  return result;
};
