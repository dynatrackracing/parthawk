'use strict';

exports.up = async function(knex) {
  await knex.schema.createTable('scout_alerts', (table) => {
    table.increments('id').primary();
    table.string('source', 20).notNullable(); // 'bone_pile' or 'hunters_perch'
    table.text('source_title').notNullable();
    table.decimal('part_value', 10, 2);
    table.string('yard_name', 255);
    table.string('vehicle_year', 10);
    table.string('vehicle_make', 100);
    table.string('vehicle_model', 100);
    table.string('vehicle_color', 100);
    table.string('row', 50);
    table.string('confidence', 10).notNullable(); // 'high', 'medium', 'low'
    table.text('notes');
    table.date('vehicle_set_date');
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Track when alerts were last generated
  await knex.schema.createTable('scout_alerts_meta', (table) => {
    table.string('key', 50).primary();
    table.text('value');
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('scout_alerts_meta');
  await knex.schema.dropTableIfExists('scout_alerts');
};
