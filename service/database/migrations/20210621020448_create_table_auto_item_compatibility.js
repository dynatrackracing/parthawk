'use strict';

const tableName = 'AutoItemCompatibility';

module.exports = {
  async up(knex) {
    const exists = await knex.schema.hasTable(tableName);

    if (exists) {
      return;
    }

    await knex.schema.createTable(tableName, (table) => {
      table.text('autoId').notNullable();
      table.text('itemId').notNullable();

      // table.foreign('autoId').onDelete('CASCADE').references('id').inTable('Auto');
      // table.foreign('itemId').onDelete('CASCADE').references('id').inTable('Item');

      // create timestamp strings in ISO8601 format
      table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());
    });
  },

  async down(knex) {
    await knex.schema.dropTableIfExists(tableName);
  }
}