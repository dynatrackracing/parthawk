'use strict';

const { database } = require('../../database/database');
const fs = require('fs-extra');
const glob = require('glob');
const { Model } = require('objection');


global.test = {
  async database() {
    Model.knex(database);
    await database.migrate.latest(database.client.config.migration);    
  },
};
