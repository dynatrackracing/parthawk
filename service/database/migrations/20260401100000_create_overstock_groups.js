'use strict';

exports.up = async function(knex) {
  // Drop the old single-item overstock_watch table
  await knex.schema.dropTableIfExists('overstock_watch');

  const hasGroup = await knex.schema.hasTable('overstock_group');
  if (!hasGroup) {
    await knex.schema.createTable('overstock_group', (table) => {
      table.increments('id').primary();
      table.varchar('name', 256).notNullable();
      table.varchar('part_type', 128).nullable();
      table.integer('restock_target').notNullable().defaultTo(1);
      table.integer('current_stock').defaultTo(0);
      table.integer('initial_stock').notNullable();
      table.varchar('group_type', 32).defaultTo('multi');
      table.varchar('status', 32).defaultTo('watching');
      table.timestamp('triggered_at').nullable();
      table.timestamp('acknowledged_at').nullable();
      table.text('notes').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());

      table.index('status', 'idx_overstock_group_status');
    });
  }

  const hasItem = await knex.schema.hasTable('overstock_group_item');
  if (!hasItem) {
    await knex.schema.createTable('overstock_group_item', (table) => {
      table.increments('id').primary();
      table.integer('group_id').notNullable().references('id').inTable('overstock_group').onDelete('CASCADE');
      table.varchar('ebay_item_id', 64).notNullable();
      table.varchar('title', 512).nullable();
      table.decimal('current_price', 10, 2).nullable();
      table.boolean('is_active').defaultTo(true);
      table.timestamp('added_at').defaultTo(knex.fn.now());

      table.unique(['group_id', 'ebay_item_id']);
      table.index('ebay_item_id', 'idx_overstock_item_ebay_id');
      table.index('group_id', 'idx_overstock_item_group_id');
    });
  }
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('overstock_group_item');
  await knex.schema.dropTableIfExists('overstock_group');
};
