'use strict';

exports.up = async function(knex) {
  const has = await knex.schema.hasColumn('restock_want_list', 'part_number');
  if (!has) {
    await knex.schema.alterTable('restock_want_list', (table) => {
      table.text('part_number').nullable();
      table.text('make').nullable();
      table.text('model').nullable();
    });
  }
};

exports.down = async function(knex) {
  await knex.schema.alterTable('restock_want_list', (table) => {
    table.dropColumn('part_number');
    table.dropColumn('make');
    table.dropColumn('model');
  });
};
