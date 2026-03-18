'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Platform cross-reference tables: platform_group, platform_vehicle, platform_shared_part.
 * Seeds 24 platform groups covering Chrysler, GM, Ford, Japanese, Korean, German vehicles.
 * Enables attack list to match yard vehicles against sales from platform siblings.
 */
module.exports = {
  async up(knex) {
    const sqlFile = path.resolve(__dirname, '001_platform_cross_reference.sql');
    const sql = fs.readFileSync(sqlFile, 'utf-8');

    // Split by semicolons and execute each statement (skip empty/comment-only)
    const statements = sql.split(';').map(s => s.trim()).filter(s => {
      if (!s) return false;
      // Skip pure comment blocks
      const withoutComments = s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
      return withoutComments.length > 0;
    });

    for (const stmt of statements) {
      try {
        await knex.raw(stmt);
      } catch (err) {
        // Ignore "already exists" / "duplicate" errors — migration is idempotent
        if (!err.message.includes('already exists') && !err.message.includes('duplicate')) {
          console.warn('Platform migration statement warning:', err.message.substring(0, 100));
        }
      }
    }
  },

  async down(knex) {
    await knex.schema.dropTableIfExists('platform_shared_part');
    await knex.schema.dropTableIfExists('platform_vehicle');
    await knex.schema.dropTableIfExists('platform_group');
  }
};
