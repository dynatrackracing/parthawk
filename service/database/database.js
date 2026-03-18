'use strict';

const fs = require('fs-extra');
const knex = require('knex');
const knexfile = require('./knexfile');
const { log } = require('../lib/logger');
const path = require('path');

const defaultKnexConfig = knexfile[process.env.NODE_ENV || 'development'];

function init({ knexConfig = defaultKnexConfig } = {}) {
  // make sure the directory exists before we create the knex instance
  if (knexConfig.connection.filename && knexConfig.connection.filename !== ':memory:') {
    const response = fs.ensureDirSync(path.dirname(knexConfig.connection.filename));
  }

  const database = knex(knexConfig);

  // enable db query logging if DB_LOGGING env var is set
  const dbLogLevel = process.env.DB_LOGGING;
  if (dbLogLevel) {
    database.on('query', (data) => {
      // don't log if the log level isnt even enabled
      if (!log[dbLogLevel]()) {
        return;
      }

      if (data.bindings) {
        log[dbLogLevel]({ sql: data.sql, bindings: data.bindings }, 'sql query');
      } else {
        log[dbLogLevel]({ sql: data.sql }, 'sql query');
      }
    });
  }

  return database;
}

const db = init();

module.exports = {
  init,
  defaultKnexConfig,
  database: db,
};