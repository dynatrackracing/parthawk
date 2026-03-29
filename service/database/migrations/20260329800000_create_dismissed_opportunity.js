'use strict';

exports.up = async function(knex) {
  await knex.schema.createTable('dismissed_opportunity', (table) => {
    table.increments('id').primary();
    table.text('opportunity_key').unique().notNullable();
    table.text('original_title');
    table.timestamp('dismissed_at').notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('dismissed_opportunity');
};
