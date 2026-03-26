'use strict';

exports.up = async function(knex) {
  if (!await knex.schema.hasTable('instant_research_cache')) {
    await knex.schema.createTable('instant_research_cache', (table) => {
      table.increments('id').primary();
      table.string('vehicle_key', 200).unique().notNullable();
      table.string('vehicle_display', 200);
      table.jsonb('results');
      table.timestamp('last_updated').defaultTo(knex.fn.now());
    });
  }
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('instant_research_cache');
};
