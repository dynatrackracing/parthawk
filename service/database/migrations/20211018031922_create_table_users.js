'use strict';

const tableName = 'User';

module.exports = {
  async up(knex) {
    const exists = await knex.schema.hasTable(tableName);

    if (exists) {
      return;
    }

    await knex.schema.createTable(tableName, (table) => {
      table.increments('id');
      table.text('firstName').notNullable();
      table.text('lastName').notNullable();
      table.text('email').notNullable();
      table.text('imageUrl');
      table.boolean('isAdmin');
      table.boolean('isVerified');

      // create timestamp strings in ISO8601 format
      table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updatedAt').notNullable().defaultTo(knex.fn.now());

    });
  },

  async down(knex) {
    await knex.schema.dropTableIfExists(tableName);
  }
};