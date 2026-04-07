'use strict';

exports.up = async function(knex) {
  await knex.schema.alterTable('blocked_comps', (table) => {
    table.string('block_type', 16).notNullable().defaultTo('comp');
    table.string('part_type', 64);
    table.integer('year');
    table.string('make', 64);
    table.string('model', 64);
  });

  // source_item_id is no longer NOT NULL (sold blocks won't have one)
  await knex.raw('ALTER TABLE blocked_comps ALTER COLUMN source_item_id DROP NOT NULL');

  // Drop old unique constraint, replace with partial unique indexes
  await knex.raw('ALTER TABLE blocked_comps DROP CONSTRAINT IF EXISTS blocked_comps_source_item_id_key');
  await knex.raw('DROP INDEX IF EXISTS blocked_comps_source_item_id_unique');

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS blocked_comps_unique_comp
    ON blocked_comps(source_item_id) WHERE block_type = 'comp' AND source_item_id IS NOT NULL
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS blocked_comps_unique_sold
    ON blocked_comps(part_type, year, make, model) WHERE block_type = 'sold' AND part_type IS NOT NULL
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_blocked_comps_sold_lookup
    ON blocked_comps(part_type, year, make, model) WHERE block_type = 'sold'
  `);

  // Backfill existing rows
  await knex.raw("UPDATE blocked_comps SET block_type = 'comp' WHERE block_type IS NULL OR block_type = 'comp'");
};

exports.down = async function(knex) {
  await knex.raw('DROP INDEX IF EXISTS blocked_comps_unique_comp');
  await knex.raw('DROP INDEX IF EXISTS blocked_comps_unique_sold');
  await knex.raw('DROP INDEX IF EXISTS idx_blocked_comps_sold_lookup');
  await knex.schema.alterTable('blocked_comps', (table) => {
    table.dropColumn('block_type');
    table.dropColumn('part_type');
    table.dropColumn('year');
    table.dropColumn('make');
    table.dropColumn('model');
  });
};
