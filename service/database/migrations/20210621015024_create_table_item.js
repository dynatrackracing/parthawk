'use strict';

const tableName = 'Item';

module.exports = {
  async up(knex) {
    const exists = await knex.schema.hasTable(tableName);

    if (exists) {
      return;
    }

    await knex.schema.createTable(tableName, (table) => {
      table.text('id').notNullable();;
      table.text('ebayId').notNullable();
      table.decimal('price').notNullable();
      table.integer('quantity');
      table.text('title').notNullable();
      table.text('categoryId').notNullable();
      table.text('categoryTitle').notNullable();
      table.text('seller').notNullable();
      table.text('manufacturerPartNumber');
      table.text('manufacturerId');
      table.text('pictureUrl');
      table.boolean('processed').defaultTo(false);


      // create timestamp strings in ISO8601 format
      table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updatedAt').notNullable().defaultTo(knex.fn.now());

      table.primary(['ebayId',]);
    });
  },

  async down(knex) {
    await knex.schema.dropTableIfExists(tableName);
  }
}