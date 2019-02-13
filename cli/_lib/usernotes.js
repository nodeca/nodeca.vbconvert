// Import user notepad data (rcd_notepad)
//

'use strict';

const Promise  = require('bluebird');
const progress = require('./utils').progress;


// Convert plain text to markdown,
// code is similar to one in bbcode formatter
//
function text_to_md(text) {
  return text.split(/(?:\r?\n){2,}/g)
             // escape inline tags
             .map(line => line.replace(/([_*\\`~^&])/g, '\\$1')
                              .replace(/(<)(?=[^\s]+>)/g, '\\$1')
                              .replace(/(\[)(?=.*\](?:[:(]))/g, '\\$1')
                              // replace newlines with "\" + newline,
                              // different from bbcode formatter
                              .replace(/\s*$/, '')
                              .replace(/\r?\n/g, ' \\\n'))
             .join('\n\n')
             // escape block tags
             .replace(/^(\t|\s{4})\s*/mg, ' ')
             .replace(/^(\s*)(([*_=-])\s*(\3\s*)+)$/mg, '$1\\$2')
             .replace(/^(\s*)([#>])/mg, '$1\\$2')
             // escape lists (different from bbcode formatter)
             .replace(/^(\s*)(([-+*]|\d+[.)])\s+)/mg, '$1\\$2');
}


module.exports = async function (N) {
  let conn = await N.vbconvert.getConnection();
  let rows, bar;

  rows = (await conn.query(`
    SELECT userid,rcd_notepad
    FROM usertextfield
    WHERE NOT ISNULL(rcd_notepad)
      AND rcd_notepad != ''
      AND rcd_notepad != 'Здесь можно хранить любые заметки.'
  `))[0];

  bar = progress(' usernotes :current/:total :percent', rows.length);

  await Promise.map(rows, async row => {
    bar.tick();

    let user = await N.models.users.User.findOne({ hid: row.userid }).lean(true);
    let text = text_to_md(row.rcd_notepad);

    // all plugins are disabled, so we're only running parser to get default
    // layout; note that attachments, user_info, etc. are not submitted
    // because they are currently only used in plugins
    let parse_result = await N.parser.md2html({ text, options: {} });

    await N.models.users.UserNote.updateOne({
      from: user._id,
      to:   user._id
    }, {
      $setOnInsert: {
        md:      text,
        html:    parse_result.html,
        version: 0
      }
    }, { upsert: true });
  }, { concurrency: 100 });

  bar.terminate();

  conn.release();
  N.logger.info('User note import finished');
};
