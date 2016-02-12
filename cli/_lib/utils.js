
'use strict';

const ProgressBar = require('progress');

const html_entities = {
  '&amp;':  '&',
  '&quot;': '"',
  '&gt;':   '>',
  '&lt;':   '<'
};


// Replace html entities like "&quot;" with the corresponding characters
//
module.exports.html_unescape = function (text) {
  return text.replace(/&(?:quot|amp|lt|gt|#(\d{1,6}));/g, (entity, code) =>
    (html_entities[entity] || String.fromCharCode(+code))
  );
};


// Wrapper for 'progress'
//
module.exports.progress = function (text, total) {
  if (!process.stderr.isTTY) {
    return {
      tick() {},
      terminate() {}
    };
  }

  return new ProgressBar(text, {
    stream: process.stderr,
    complete: '=',
    incomplete: ' ',
    width: 40,
    clear: true,
    total,
    renderThrottle: 300
  });
};
