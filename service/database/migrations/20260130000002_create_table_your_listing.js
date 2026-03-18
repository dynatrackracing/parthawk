'use strict';

const tableName = 'YourListing';

module.exports = {
  async up(knex) {
    const exists = await knex.schema.hasTable(tableName);

    if (exists) {
      return;
    }

    await knex.schema.createTable(tableName, (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('ebayItemId').notNullable().unique();
      table.text('title');
      table.text('sku');
      table.integer('quantityAvailable');
      table.decimal('currentPrice', 10, 2);
      table.text('listingStatus');
      table.timestamp('startTime');
      table.text('viewItemUrl');
      table.timestamp('syncedAt').defaultTo(knex.fn.now());

      table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updatedAt').notNullable().defaultTo(knex.fn.now());
    });

    // Create indexes
    await knex.schema.alterTable(tableName, (table) => {
      table.index('ebayItemId', 'idx_your_listing_item_id');
      table.index('startTime', 'idx_your_listing_start_time');
    });
  },

  async down(knex) {
    await knex.schema.dropTableIfExists(tableName);
  }
};
