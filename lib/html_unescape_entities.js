
'use strict';

const html_entities = {
  '&amp;':  '&',
  '&quot;': '"',
  '&gt;':   '>',
  '&lt;':   '<'
};


// Replace html entities like "&quot;" with the corresponding characters
//
module.exports = function (text) {
  return text.replace(/&(?:quot|amp|lt|gt|#(\d{1,6}));/g, (entity, code) =>
    (html_entities[entity] || String.fromCodePoint(+code))
  );
};
