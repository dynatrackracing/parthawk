'use strict';

const { dataDir } = require('../lib/constants');
const path = require('path');

const migrationsDir = path.resolve(__dirname, 'migrations');

const client = 'pg';
const migration = {
  directory: migrationsDir,
};

const useNullAsDefault = true;
const pool = {
  afterCreate: (conn, done) => {
    // turn on foreign key checking, it is off by default in sqlite3
    conn.run('PRAGMA foreign_keys = ON', done);
  },
};


module.exports = {
  development: {
    client,
    // Use DATABASE_URL if provided (for connecting to prod from local), otherwise use local config
    connection: process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
      : {
          host: process.env.DB_HOST || '127.0.0.1',
          user: process.env.DB_USER || 'wms',
          password: process.env.DB_PASSWORD || 'wms_password',
          database: process.env.DB_NAME || 'dynatrack',
        },
    migration,
    useNullAsDefault,
  },
  test: {
    client,
    connection: {
      host: process.env.DB_HOST || '127.0.0.1',
      user: process.env.DB_USER || 'wms',
      password: process.env.DB_PASSWORD || 'wms_password',
      database: process.env.DB_TEST_NAME || 'dynatrack_test',
    },
    migration,
    useNullAsDefault,
  },
  production: {
    client,
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    },
    migration,
    useNullAsDefault,
  },
}

