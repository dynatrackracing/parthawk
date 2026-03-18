'use strict';

const tableName = 'ItemInterchangeNumber';

module.exports = {
  async up(knex) {
    const exists = await knex.schema.hasTable(tableName);

    if (exists) {
      return;
    }

    await knex.schema.createTable(tableName, (table) => {
      table.text('manufacturerPartNumber').unsigned().notNullable();
      table.text('interchangePartId').unsigned().notNullable();

      // table.foreign('itemId').onDelete('CASCADE').references('id').inTable('Item');
      // table.foreign('interchangePartId').onDelete('CASCADE').references('id').inTable('InterchangeNumber');

      // create timestamp strings in ISO8601 format
      table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());
    });
  },

  async down(knex) {
    await knex.schema.dropTableIfExists(tableName);
  }
}