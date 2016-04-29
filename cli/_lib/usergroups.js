// Convert usergroups
//

'use strict';

const co = require('co');

const can_view_forum             = 1;
const can_post_threads           = 16;
const can_open_close_own_threads = 1024;


/* eslint-disable no-bitwise */
module.exports = co.wrap(function* (N) {
  let conn = yield N.vbconvert.getConnection();

  let rows = yield conn.query(`
    SELECT usergroupid,title,forumpermissions,pmquota
    FROM usergroup
  `);

  let mapping = N.config.vbconvert.usergroups;

  let store = N.settings.getStore('usergroup');

  if (!store) throw 'Settings store `usergroup` is not registered.';

  yield rows.map(co.wrap(function* (row) {
    let usergroup, usergroup_id;

    if (mapping[row.usergroupid] === false) {
      // ignore some usergroups
      return;
    } else if (typeof mapping[row.usergroupid] !== 'undefined') {
      usergroup_id = yield N.models.users.UserGroup.findIdByName(mapping[row.usergroupid]);
    } else {
      usergroup = new N.models.users.UserGroup({
        short_name: row.title
      });

      usergroup_id = usergroup._id;
    }

    try {
      yield new N.models.vbconvert.UserGroupMapping({
        mysql: row.usergroupid,
        mongo: usergroup_id
      }).save();
    } catch (err) {
      // ignore duplicate key errors
      if (err.code !== 11000) throw err;

      return;
    }

    if (usergroup) {
      yield usergroup.save();
    }

    yield store.set({
      forum_can_view:         { value: !!(row.forumpermissions & can_view_forum) },
      forum_can_reply:        { value: !!(row.forumpermissions & can_post_threads) },
      forum_can_start_topics: { value: !!(row.forumpermissions & can_post_threads) },
      forum_can_close_topic:  { value: !!(row.forumpermissions & can_open_close_own_threads) },
      can_send_messages:      { value: row.pmquota > 0 },
      can_use_messages:       { value: row.pmquota > 0 }
    }, { usergroup_id });
  }));

  yield store.updateInherited();

  conn.release();
  N.logger.info('UserGroup import finished');
});
