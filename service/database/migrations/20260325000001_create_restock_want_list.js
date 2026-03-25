'use strict';

exports.up = async function(knex) {
  await knex.schema.createTable('restock_want_list', (table) => {
    table.increments('id').primary();
    table.text('title').notNullable();
    table.text('notes');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.boolean('active').defaultTo(true);
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('restock_want_list');
};
