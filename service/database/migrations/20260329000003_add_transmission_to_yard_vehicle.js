'use strict';

exports.up = async function(knex) {
  const has1 = await knex.schema.hasColumn('yard_vehicle', 'decoded_transmission');
  const has2 = await knex.schema.hasColumn('yard_vehicle', 'transmission_speeds');

  await knex.schema.alterTable('yard_vehicle', (table) => {
    if (!has1) table.text('decoded_transmission');
    if (!has2) table.text('transmission_speeds');
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('yard_vehicle', (table) => {
    table.dropColumn('decoded_transmission');
    table.dropColumn('transmission_speeds');
  });
};
