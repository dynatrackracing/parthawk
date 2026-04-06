'use strict';

exports.up = async function(knex) {
  // Ensure vin_decoder schema exists
  await knex.raw('CREATE SCHEMA IF NOT EXISTS vin_decoder');

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS vin_decoder.epa_transmission (
      id SERIAL PRIMARY KEY,
      year SMALLINT NOT NULL,
      make VARCHAR(50) NOT NULL,
      model_raw VARCHAR(100) NOT NULL,
      model_clean VARCHAR(100) NOT NULL,
      cylinders VARCHAR(10),
      displacement VARCHAR(10),
      drive VARCHAR(60),
      trans_type VARCHAR(20) NOT NULL,
      trans_speeds VARCHAR(10),
      trans_sub_type VARCHAR(10),
      trany_raw VARCHAR(60)
    )
  `);

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_epa_trans_lookup ON vin_decoder.epa_transmission(year, make)');

  // Also add trans_sub_type and trans_source to vin_cache
  const has1 = await knex.schema.hasColumn('vin_cache', 'trans_sub_type');
  if (!has1) {
    await knex.schema.alterTable('vin_cache', (table) => {
      table.string('trans_sub_type', 10).nullable();
    });
  }
  const has2 = await knex.schema.hasColumn('vin_cache', 'trans_source');
  if (!has2) {
    await knex.schema.alterTable('vin_cache', (table) => {
      table.string('trans_source', 20).nullable();
    });
  }
};

exports.down = async function(knex) {
  await knex.raw('DROP TABLE IF EXISTS vin_decoder.epa_transmission');
  try {
    await knex.schema.alterTable('vin_cache', (table) => {
      table.dropColumn('trans_sub_type');
      table.dropColumn('trans_source');
    });
  } catch (e) {}
};
