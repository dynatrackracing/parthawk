'use strict';

const fs = require('fs');
const path = require('path');

module.exports = {
  async up(knex) {
    const sqlFile = path.resolve(__dirname, '002_fitment_data.sql');
    const sql = fs.readFileSync(sqlFile, 'utf-8');
    const statements = sql.split(';').map(s => s.trim()).filter(s => {
      const clean = s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
      return clean.length > 0;
    });
    for (const stmt of statements) {
      try { await knex.raw(stmt); }
      catch (err) {
        if (!err.message.includes('already exists') && !err.message.includes('duplicate')) {
          console.warn('Fitment migration warning:', err.message.substring(0, 100));
        }
      }
    }
  },
  async down(knex) {
    await knex.schema.dropTableIfExists('fitment_scrape_queue');
    await knex.schema.dropTableIfExists('fitment_data');
  }
};
