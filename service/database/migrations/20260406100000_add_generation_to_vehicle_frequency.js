'use strict';

exports.up = async function(knex) {
  // Add generation columns
  const hasGenStart = await knex.schema.hasColumn('vehicle_frequency', 'gen_start');
  if (!hasGenStart) {
    await knex.schema.alterTable('vehicle_frequency', (table) => {
      table.integer('gen_start').nullable();
      table.integer('gen_end').nullable();
    });
  }

  // Drop the old primary key (make, model) and recreate with gen columns
  // Can't change PK directly — add a unique index instead for the new composite key
  try {
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_vf_make_model_gen ON vehicle_frequency (make, model, COALESCE(gen_start, 0), COALESCE(gen_end, 0))');
  } catch (e) { /* index may already exist */ }
};

exports.down = async function(knex) {
  try {
    await knex.raw('DROP INDEX IF EXISTS idx_vf_make_model_gen');
  } catch (e) {}
  const hasGenStart = await knex.schema.hasColumn('vehicle_frequency', 'gen_start');
  if (hasGenStart) {
    await knex.schema.alterTable('vehicle_frequency', (table) => {
      table.dropColumn('gen_start');
      table.dropColumn('gen_end');
    });
  }
};
