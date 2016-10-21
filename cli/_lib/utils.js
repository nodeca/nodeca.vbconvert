
'use strict';

const _ = require('lodash');

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


// Simple progress bar implementation
//
module.exports.progress = function (text, total) {
  let terminated = false;
  let current = 0;

  let refresh_progress = _.throttle(() => {
    process.stderr.write('\r');
    process.stderr.clearLine();

    process.stderr.write(
      text.replace(/:current/g, current)
          .replace(/:total/g,   total)
          .replace(/:percent/g, (current / total * 100).toFixed(1) + '%')
    );
  }, 300);

  let bar = {
    tick(diff = 1) {
      current += diff;

      if (!process.stderr.isTTY) return;
      if (terminated) return;

      refresh_progress();
    },

    terminate() {
      if (!process.stderr.isTTY) return;
      if (terminated) return;

      process.stderr.write('\r');
      process.stderr.clearLine();
    }
  };

  bar.tick(0);

  return bar;
};
