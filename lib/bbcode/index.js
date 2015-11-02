
'use strict';


var tokenize = require('./tokenize');
var to_html  = require('./format_html');
var to_md    = require('./format_md');


module.exports.bbcode_to_markdown = function (bbcode) {
  return to_md(tokenize(bbcode));
};

// this convertor is mostly for testing purposes
module.exports.bbcode_to_html = function (bbcode) {
  return to_html(tokenize(bbcode));
};
