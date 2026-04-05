'use strict';

exports.up = async function(knex) {
  const has1 = await knex.schema.hasColumn('vin_cache', 'transmission_style');
  if (!has1) {
    await knex.schema.alterTable('vin_cache', (table) => {
      table.text('transmission_style').nullable();
    });
  }
  const has2 = await knex.schema.hasColumn('vin_cache', 'transmission_speeds');
  if (!has2) {
    await knex.schema.alterTable('vin_cache', (table) => {
      table.text('transmission_speeds').nullable();
    });
  }
};

exports.down = async function(knex) {
  await knex.schema.alterTable('vin_cache', (table) => {
    table.dropColumn('transmission_style');
    table.dropColumn('transmission_speeds');
  });
};
