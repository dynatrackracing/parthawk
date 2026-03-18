'use strict';

/**
 * Add 7-day vehicle retention columns to yard_vehicle.
 * - first_seen: when vehicle was first scraped
 * - last_seen: when vehicle was last confirmed present on the lot
 * - Existing 'active' column repurposed: true = seen in latest scrape
 *
 * Vehicles not seen in latest scrape get active=false but remain
 * queryable for 7 days via last_seen filter.
 */
module.exports = {
  async up(knex) {
    try {
      const hasFirstSeen = await knex.schema.hasColumn('yard_vehicle', 'first_seen');
      if (!hasFirstSeen) {
        await knex.schema.alterTable('yard_vehicle', table => {
          table.timestamp('first_seen');
        });
        // Backfill: set first_seen = createdAt for existing rows
        await knex.raw('UPDATE yard_vehicle SET first_seen = "createdAt" WHERE first_seen IS NULL');
      }
    } catch (e) { /* column may already exist */ }

    try {
      const hasLastSeen = await knex.schema.hasColumn('yard_vehicle', 'last_seen');
      if (!hasLastSeen) {
        await knex.schema.alterTable('yard_vehicle', table => {
          table.timestamp('last_seen');
        });
        // Backfill: set last_seen = scraped_at for existing rows
        await knex.raw('UPDATE yard_vehicle SET last_seen = scraped_at WHERE last_seen IS NULL');
      }
    } catch (e) { /* column may already exist */ }
  },

  async down(knex) {
    try {
      await knex.schema.alterTable('yard_vehicle', table => {
        table.dropColumn('first_seen');
        table.dropColumn('last_seen');
      });
    } catch (e) { /* ignore */ }
  }
};
