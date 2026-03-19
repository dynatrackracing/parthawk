'use strict';

module.exports = {
  async up(knex) {
    const exists = await knex.schema.hasTable('vin_scan_log');
    if (!exists) {
      await knex.schema.createTable('vin_scan_log', table => {
        table.increments('id').primary();
        table.string('vin', 17).notNullable();
        table.integer('year');
        table.string('make', 50);
        table.string('model', 100);
        table.string('trim', 100);
        table.string('engine', 50);
        table.string('engine_type', 20);
        table.string('drivetrain', 20);
        table.string('paint_code', 20);
        table.string('scanned_by', 50);
        table.timestamp('scanned_at').defaultTo(knex.fn.now());
        table.string('source', 20).defaultTo('manual');
        table.text('notes');
        table.index('vin');
        table.index('scanned_at');
      });
    }

    // Also ensure vin_cache has raw_nhtsa column for full decode data
    try {
      const hasRaw = await knex.schema.hasColumn('vin_cache', 'raw_nhtsa');
      if (!hasRaw) {
        await knex.schema.alterTable('vin_cache', table => {
          table.text('raw_nhtsa');
        });
      }
    } catch (e) { /* ignore */ }
  },

  async down(knex) {
    await knex.schema.dropTableIfExists('vin_scan_log');
  }
};
