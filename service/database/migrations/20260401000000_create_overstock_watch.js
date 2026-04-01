'use strict';

exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('overstock_watch');
  if (!exists) {
    await knex.schema.createTable('overstock_watch', (table) => {
      table.increments('id').primary();
      table.varchar('ebay_item_id', 64).unique().notNullable();
      table.varchar('title', 512).notNullable();
      table.varchar('part_number_base', 128).nullable();
      table.integer('current_quantity').defaultTo(0);
      table.integer('initial_quantity').notNullable();
      table.integer('restock_target').notNullable().defaultTo(1);
      table.varchar('status', 32).defaultTo('watching');
      table.timestamp('triggered_at').nullable();
      table.timestamp('acknowledged_at').nullable();
      table.text('notes').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());

      table.index('status', 'idx_overstock_watch_status');
    });
  }
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('overstock_watch');
};
