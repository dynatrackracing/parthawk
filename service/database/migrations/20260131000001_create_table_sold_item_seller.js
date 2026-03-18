'use strict';

exports.up = async function(knex) {
  await knex.schema.createTable('SoldItemSeller', (table) => {
    table.text('name').primary(); // eBay seller username
    table.boolean('enabled').defaultTo(true);
    table.integer('itemsScraped').defaultTo(0);
    table.timestamp('lastScrapedAt');
    table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updatedAt').notNullable().defaultTo(knex.fn.now());
  });

  // Index for finding enabled sellers
  await knex.schema.raw('CREATE INDEX idx_sold_item_seller_enabled ON "SoldItemSeller"(enabled)');
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('SoldItemSeller');
};
