'use strict';

exports.up = async function(knex) {
  await knex.schema.alterTable('restock_want_list', (table) => {
    table.boolean('pulled').defaultTo(false);
    table.timestamp('pulled_date');
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('restock_want_list', (table) => {
    table.dropColumn('pulled');
    table.dropColumn('pulled_date');
  });
};
