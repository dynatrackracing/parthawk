'use strict';

exports.up = async function(knex) {
  const has1 = await knex.schema.hasColumn('yard_vehicle', 'audio_brand');
  const has2 = await knex.schema.hasColumn('yard_vehicle', 'expected_parts');
  const has3 = await knex.schema.hasColumn('yard_vehicle', 'cult');

  await knex.schema.alterTable('yard_vehicle', (table) => {
    if (!has1) table.text('audio_brand');
    if (!has2) table.text('expected_parts');
    if (!has3) table.boolean('cult').defaultTo(false);
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('yard_vehicle', (table) => {
    table.dropColumn('audio_brand');
    table.dropColumn('expected_parts');
    table.dropColumn('cult');
  });
};
