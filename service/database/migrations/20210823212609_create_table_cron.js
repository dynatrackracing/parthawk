'use strict';

const tableName = 'Cron';

module.exports = {
  async up(knex) {
    const exists = await knex.schema.hasTable(tableName);

    if (exists) {
      return;
    }

    await knex.schema.createTable(tableName, (table) => {
      table.text('id').notNullable();
      table.integer('total');
      table.integer('processed');
      table.integer('unprocessed');
      table.decimal('elapsed');
      table.integer('duplicate');
      table.integer('apiCalls');

       // create timestamp strings in ISO8601 format
       table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());
       table.timestamp('updatedAt').notNullable().defaultTo(knex.fn.now());
    });
  },

  async down(knex) {
    await knex.schema.dropTableIfExists(tableName);
  }
}