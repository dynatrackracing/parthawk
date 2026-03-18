'use strict';

const tableName = 'PriceCheck';

module.exports = {
  async up(knex) {
    const exists = await knex.schema.hasTable(tableName);

    if (exists) {
      return;
    }

    await knex.schema.createTable(tableName, (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('listingId').references('id').inTable('YourListing').onDelete('CASCADE');
      table.text('title').notNullable();

      // Your price at time of check
      table.decimal('yourPrice', 10, 2);

      // Market data
      table.decimal('marketMedian', 10, 2);
      table.decimal('marketMin', 10, 2);
      table.decimal('marketMax', 10, 2);
      table.decimal('marketAvg', 10, 2);
      table.integer('compCount');
      table.decimal('salesPerWeek', 10, 2);

      // Verdict
      table.text('verdict'); // MARKET PRICE, OVERPRICED, UNDERPRICED, etc.
      table.decimal('priceDiffPercent', 10, 2);

      // Extracted parts for debugging
      table.text('partType');
      table.text('make');
      table.text('model');
      table.text('years');
      table.text('searchQuery');

      // Top comps (JSON array)
      table.jsonb('topComps');

      table.timestamp('checkedAt').notNullable().defaultTo(knex.fn.now());
      table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updatedAt').notNullable().defaultTo(knex.fn.now());
    });

    // Indexes
    await knex.schema.alterTable(tableName, (table) => {
      table.index('listingId', 'idx_price_check_listing_id');
      table.index('checkedAt', 'idx_price_check_checked_at');
    });
  },

  async down(knex) {
    await knex.schema.dropTableIfExists(tableName);
  }
};
