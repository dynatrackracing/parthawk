'use strict';

const tableName = 'YourSale';

module.exports = {
  async up(knex) {
    const exists = await knex.schema.hasTable(tableName);

    if (exists) {
      return;
    }

    await knex.schema.createTable(tableName, (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('ebayOrderId').notNullable().unique();
      table.text('ebayItemId');
      table.text('title');
      table.text('sku');
      table.integer('quantity');
      table.decimal('salePrice', 10, 2);
      table.timestamp('soldDate');
      table.text('buyerUsername');
      table.timestamp('shippedDate');

      table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updatedAt').notNullable().defaultTo(knex.fn.now());
    });

    // Create indexes
    await knex.schema.alterTable(tableName, (table) => {
      table.index('soldDate', 'idx_your_sale_sold_date');
      table.index('ebayItemId', 'idx_your_sale_item_id');
    });
  },

  async down(knex) {
    await knex.schema.dropTableIfExists(tableName);
  }
};
