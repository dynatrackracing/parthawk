'use strict';

exports.up = async function(knex) {
  await knex.schema.createTable('sky_watch_research', (table) => {
    table.increments('id').primary();
    table.integer('vehicle_year').notNullable();
    table.varchar('vehicle_make', 64).notNullable();
    table.varchar('vehicle_model', 128).notNullable();
    table.varchar('vehicle_engine', 128).nullable();
    table.varchar('vehicle_trim', 128).nullable();
    table.varchar('source', 32).notNullable();
    table.varchar('source_vin', 17).nullable();
    table.jsonb('results').notNullable();
    table.decimal('total_estimated_value', 10, 2).nullable();
    table.integer('parts_found_count').defaultTo(0);
    table.integer('high_value_count').defaultTo(0);
    table.varchar('status', 32).defaultTo('new');
    table.timestamp('reviewed_at').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index('status');
    table.index(['vehicle_make', 'vehicle_model']);
    table.unique(['vehicle_year', 'vehicle_make', 'vehicle_model', 'vehicle_engine']);
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('sky_watch_research');
};
