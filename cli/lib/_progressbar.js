// Wrapper for 'progress'
//

'use strict';

var ProgressBar = require('progress');


module.exports = function (text, total) {
  if (!process.stderr.isTTY) {
    return {
      tick: function () {},
      terminate: function () {}
    };
  }

  return new ProgressBar(text, {
    stream: process.stderr,
    complete: '=',
    incomplete: ' ',
    width: 40,
    clear: true,
    total: total,
    renderThrottle: 300
  });
};
