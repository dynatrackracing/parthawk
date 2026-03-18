'use strict';

const tableName = 'User';

module.exports = {
  async up(knex) {
    // add columns to items table
    await knex.schema.table(tableName, (table) => {
      table.boolean('canSeePrice').defaultTo(true);
    });
  },

  async down(knex) {
    await knex.schema.table(tableName, (table) => {
      table.dropColumn('canSeePrice');
    });
  },
};
