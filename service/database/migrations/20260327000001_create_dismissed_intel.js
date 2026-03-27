'use strict';

exports.up = async function(knex) {
  await knex.schema.createTable('dismissed_intel', (table) => {
    table.text('normalizedTitle').primary();
    table.text('originalTitle');
    table.timestamp('dismissedAt').notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('dismissed_intel');
};
