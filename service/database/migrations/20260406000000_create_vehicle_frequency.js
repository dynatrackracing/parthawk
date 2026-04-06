'use strict';

exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('vehicle_frequency');
  if (exists) return;
  await knex.schema.createTable('vehicle_frequency', (table) => {
    table.text('make').notNullable();
    table.text('model').notNullable();
    table.integer('total_seen').notNullable().defaultTo(0);
    table.timestamp('first_tracked_at').notNullable();
    table.timestamp('last_seen_at').notNullable();
    table.float('avg_days_between').nullable();
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.primary(['make', 'model']);
    table.index('avg_days_between', 'idx_vehicle_frequency_avg_days');
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('vehicle_frequency');
};
