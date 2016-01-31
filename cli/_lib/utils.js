
'use strict';

const ProgressBar = require('progress');


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
