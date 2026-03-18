'use strict';

const tableName = 'Item';

module.exports = {
  async up(knex) {
    // add columns to items table
    await knex.schema.table(tableName, (table) => {
      table.integer('difficulty');
      table.integer('salesEase');
      table.text('notes');
    });
  },

  async down(knex) {
    await knex.schema.table(tableName, (table) => {
      table.dropColumn('difficulty');
      table.dropColumn('salesEase');
      table.text('notes');
    });
  },
};
