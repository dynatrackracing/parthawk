'use strict';

exports.up = async function(knex) {
  await knex.schema.alterTable('vin_cache', (table) => {
    table.boolean('is_hybrid').defaultTo(false);
    table.boolean('is_phev').defaultTo(false);
    table.boolean('is_electric').defaultTo(false);
    table.text('fuel_type');
  });
  await knex.schema.alterTable('vin_cache', (table) => {
    table.index('is_electric', 'idx_vin_cache_electric');
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('vin_cache', (table) => {
    table.dropIndex('is_electric', 'idx_vin_cache_electric');
    table.dropColumn('fuel_type');
    table.dropColumn('is_electric');
    table.dropColumn('is_phev');
    table.dropColumn('is_hybrid');
  });
};
