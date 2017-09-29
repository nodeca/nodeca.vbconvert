// Convert usergroups
//

'use strict';

const _  = require('lodash');


/* eslint-disable no-bitwise */
module.exports = async function (N) {
  let conn = await N.vbconvert.getConnection();

  let rows = (await conn.query(`
    SELECT usergroupid,title
    FROM usergroup
  `))[0];

  let configs = {};

  for (let usergroupid of Object.keys(N.config.vbconvert.usergroups)) {
    configs[usergroupid] = typeof N.config.vbconvert.usergroups[usergroupid] === 'string' ?
                           { short_name: N.config.vbconvert.usergroups[usergroupid] } :
                           N.config.vbconvert.usergroups[usergroupid];
  }

  let store = N.settings.getStore('usergroup');

  if (!store) throw 'Settings store `usergroup` is not registered.';

  for (let row of rows) {
    row.config = configs[row.usergroupid];
    row.settings = (row.config || {}).settings || {};
  }

  await Promise.all(rows.map(async row => {
    let usergroup, config = row.config;

    // ignore some usergroups
    if (!config) return;

    usergroup = await N.models.users.UserGroup.findOne({ short_name: config.short_name }).lean(false);

    if (!usergroup) {
      usergroup = new N.models.users.UserGroup({ short_name: config.short_name });
    }

    try {
      await new N.models.vbconvert.UserGroupMapping({
        mysql: row.usergroupid,
        mongo: usergroup._id
      }).save();
    } catch (err) {
      // ignore duplicate key errors
      if (err.code !== 11000) throw err;

      return;
    }

    await usergroup.save();
  }));


  // update parent_group
  await Promise.all(rows.map(async row => {
    let config = row.config;

    if (!config) return;
    if (!config.parent) return;

    let usergroup = await N.models.users.UserGroup.findOne({ short_name: config.short_name }).lean(false);
    let parent    = await N.models.users.UserGroup.findOne({ short_name: config.parent }).lean(true);

    usergroup.parent_group = parent._id;
    await usergroup.save();
  }));


  // update permissions
  await Promise.all(rows.map(async row => {
    let config = row.config;

    if (!config) return;

    let usergroup = await N.models.users.UserGroup.findOne({ short_name: config.short_name }).lean(true);
    let should_be = row.settings;

    if (!Object.keys(should_be).length) return;

    let settings = await store.get(Object.keys(should_be), { usergroup_ids: [ usergroup._id ] });

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

    await store.set(update, { usergroup_id: usergroup._id });
  }));

  conn.release();
  N.logger.info('UserGroup import finished');
};
