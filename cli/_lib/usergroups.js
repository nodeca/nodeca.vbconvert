// Convert usergroups
//

'use strict';

const _  = require('lodash');
const co = require('bluebird-co').co;


/* eslint-disable no-bitwise */
module.exports = co.wrap(function* (N) {
  let conn = yield N.vbconvert.getConnection();

  let rows = (yield conn.query(`
    SELECT usergroupid,title
    FROM usergroup
  `))[0];

  let configs = N.config.vbconvert.usergroups;

  let store = N.settings.getStore('usergroup');

  if (!store) throw 'Settings store `usergroup` is not registered.';

  for (let row of rows) {
    row.config = configs[row.usergroupid];
    row.settings = (row.config || {}).settings || {};
  }

  yield rows.map(co.wrap(function* (row) {
    let usergroup, config = row.config;

    // ignore some usergroups
    if (!config) return;

    usergroup = yield N.models.users.UserGroup.findOne({ short_name: config.short_name }).lean(false);

    if (!usergroup) {
      usergroup = new N.models.users.UserGroup({ short_name: config.short_name });
    }

    try {
      yield new N.models.vbconvert.UserGroupMapping({
        mysql: row.usergroupid,
        mongo: usergroup._id
      }).save();
    } catch (err) {
      // ignore duplicate key errors
      if (err.code !== 11000) throw err;

      return;
    }

    yield usergroup.save();
  }));


  // update parent_group
  yield rows.map(co.wrap(function* (row) {
    let config = row.config;

    if (!config) return;
    if (!config.parent) return;

    let usergroup = yield N.models.users.UserGroup.findOne({ short_name: config.short_name }).lean(false);
    let parent    = yield N.models.users.UserGroup.findOne({ short_name: config.parent }).lean(true);

    usergroup.parent_group = parent._id;
    yield usergroup.save();
  }));


  // update permissions
  yield rows.map(co.wrap(function* (row) {
    let config = row.config;

    if (!config) return;

    let usergroup = yield N.models.users.UserGroup.findOne({ short_name: config.short_name }).lean(true);
    let should_be = row.settings;

    if (!Object.keys(should_be).length) return;

    let settings = yield store.get(Object.keys(should_be), { usergroup_ids: [ usergroup._id ] });

    if (config.parent) {
      let parent = _.find(rows, r => r.config && r.config.short_name === config.parent);

      for (let key of Object.keys(parent.settings)) {
        settings[key] = parent.settings[key];
      }
    }

    let update = {};

    Object.keys(should_be).forEach(key => {
      if ((!settings[key].force !== !should_be[key].force) ||
         (!settings[key].value !== !should_be[key].value)) {

        update[key] = should_be[key];
      }
    });

    yield store.set(update, { usergroup_id: usergroup._id });
  }));

  conn.release();
  N.logger.info('UserGroup import finished');
});
