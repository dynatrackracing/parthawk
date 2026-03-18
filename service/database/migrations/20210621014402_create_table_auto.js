'use strict';

const tableName = 'Auto';

module.exports = {
  async up(knex) {
    const exists = await knex.schema.hasTable(tableName);

    if (exists) {
      return;
    }

    await knex.schema.createTable(tableName, (table) => {
      table.text('id').notNullable();
      table.integer('year').notNullable();
      table.text('make').notNullable();
      table.text('model').notNullable();
      table.text('trim');
      table.text('engine').notNullable();

      // create timestamp strings in ISO8601 format
      table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updatedAt').notNullable().defaultTo(knex.fn.now());

      table.primary(['year', 'make', 'model', 'trim', 'engine']);
    });
  },

  async down(knex) {
    await knex.schema.dropTableIfExists(tableName);
  }
}