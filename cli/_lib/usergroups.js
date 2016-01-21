// Convert usergroups
//

'use strict';

const _  = require('lodash');
const co = require('co');


module.exports = co.wrap(function* (N) {
  let conn = yield N.vbconvert.getConnection();

  let rows = yield conn.query('SELECT usergroupid, title FROM usergroup');

  let mapping = _.invert(N.config.vbconvert.usergroups);

  yield rows.map(co.wrap(function* (row) {
    let usergroup, usergroup_id;

    if (typeof mapping[row.usergroupid] !== 'undefined') {
      usergroup_id = (yield N.models.users.UserGroup.findIdByName(mapping[row.usergroupid]))._id;
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
      if (err.code !== 11000) {
        throw err;
      }

      return;
    }

    if (usergroup) {
      yield usergroup.save();
    }
  }));

  conn.release();
  N.logger.info('UserGroup import finished');
});
