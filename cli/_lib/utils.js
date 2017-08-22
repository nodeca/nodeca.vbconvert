
'use strict';

const _ = require('lodash');


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
