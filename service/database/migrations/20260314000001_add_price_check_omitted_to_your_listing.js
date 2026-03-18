'use strict';

const tableName = 'YourListing';

module.exports = {
  async up(knex) {
    const hasColumn = await knex.schema.hasColumn(tableName, 'priceCheckOmitted');
    if (hasColumn) return;

    await knex.schema.alterTable(tableName, (table) => {
      table.boolean('priceCheckOmitted').notNullable().defaultTo(false);
    });
  },

  async down(knex) {
    await knex.schema.alterTable(tableName, (table) => {
      table.dropColumn('priceCheckOmitted');
    });
  }
};
