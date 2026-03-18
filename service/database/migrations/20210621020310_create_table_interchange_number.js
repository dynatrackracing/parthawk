'use strict';

const tableName = 'InterchangeNumber';

module.exports = {
  async up(knex) {
    const exists = await knex.schema.hasTable(tableName);

    if (exists) {
      return;
    }

    await knex.schema.createTable(tableName, (table) => {
      table.text('id');
      table.text('interchangeNumber').notNullable().primary();

      // create timestamp strings in ISO8601 format
      table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updatedAt').notNullable().defaultTo(knex.fn.now());
    });
  },

  async down(knex) {
    await knex.schema.dropTableIfExists(tableName);
  }
}