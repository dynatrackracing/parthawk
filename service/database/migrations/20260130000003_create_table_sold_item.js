'use strict';

const tableName = 'SoldItem';

module.exports = {
  async up(knex) {
    const exists = await knex.schema.hasTable(tableName);

    if (exists) {
      return;
    }

    await knex.schema.createTable(tableName, (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('ebayItemId').notNullable().unique();
      table.text('title').notNullable();
      table.decimal('soldPrice', 10, 2).notNullable();
      table.timestamp('soldDate').notNullable();
      table.text('categoryId');
      table.text('categoryTitle');
      table.text('seller');
      table.text('condition');
      table.text('pictureUrl');
      table.jsonb('compatibility'); // [{year, make, model, trim, engine}, ...]
      table.text('manufacturerPartNumber');
      table.specificType('interchangeNumbers', 'text[]');

      table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updatedAt').notNullable().defaultTo(knex.fn.now());
    });

    // Create indexes
    await knex.schema.alterTable(tableName, (table) => {
      table.index('categoryId', 'idx_sold_item_category');
      table.index('seller', 'idx_sold_item_seller');
      table.index('soldDate', 'idx_sold_item_sold_date');
    });

    // Create GIN index for JSONB compatibility column
    await knex.raw('CREATE INDEX idx_sold_item_compatibility ON "SoldItem" USING GIN (compatibility)');
  },

  async down(knex) {
    await knex.schema.dropTableIfExists(tableName);
  }
};
