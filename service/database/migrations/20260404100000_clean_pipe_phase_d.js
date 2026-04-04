'use strict';

exports.up = async function(knex) {
  // A) Add key_type column
  const hasKeyType = await knex.schema.hasColumn('market_demand_cache', 'key_type');
  if (!hasKeyType) {
    await knex.schema.alterTable('market_demand_cache', function(t) {
      t.string('key_type', 10).defaultTo('pn');
    });
  }

  // B) Tag existing YMM keys
  await knex.raw("UPDATE market_demand_cache SET key_type = 'ymm' WHERE part_number_base LIKE '%|%'");

  // D) Index on key_type
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_mdc_key_type ON market_demand_cache(key_type)');
};

exports.down = async function(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_mdc_key_type');
  const has = await knex.schema.hasColumn('market_demand_cache', 'key_type');
  if (has) {
    await knex.schema.alterTable('market_demand_cache', function(t) {
      t.dropColumn('key_type');
    });
  }
};
