'use strict';

exports.up = async function(knex) {
  await knex.schema.createTable('flyway_trip', (table) => {
    table.increments('id').primary();
    table.string('name', 255).notNullable();
    table.date('start_date').notNullable();
    table.date('end_date').notNullable();
    table.string('status', 20).notNullable().defaultTo('planning');
    table.text('notes');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index('status');
  });

  await knex.schema.createTable('flyway_trip_yard', (table) => {
    table.increments('id').primary();
    table.integer('trip_id').notNullable().references('id').inTable('flyway_trip').onDelete('CASCADE');
    table.uuid('yard_id').notNullable().references('id').inTable('yard').onDelete('CASCADE');
    table.boolean('scrape_enabled').defaultTo(true);
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.unique(['trip_id', 'yard_id']);
    table.index('trip_id');
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('flyway_trip_yard');
  await knex.schema.dropTableIfExists('flyway_trip');
};
