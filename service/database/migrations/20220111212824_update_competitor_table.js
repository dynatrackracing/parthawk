'use strict';

const competitorTableName = 'Competitor';
const itemTableName = 'Item';

module.exports = {
  async up(knex) {
    // add columns to items table
    await knex.schema.table(competitorTableName, (table) => {
      table.boolean('enabled').defaultTo(false);
      table.boolean('isRepair').defaultTo(false);
    });

    await knex.schema.table(itemTableName, (table) => {
      table.boolean('isRepair').defaultTo(false);
    });
  },

  async down(knex) {
    await knex.schema.table(competitorTableName, (table) => {
      table.dropColumn('enabled');
      table.dropColumn('isRepair');
    });

    await knex.schema.table(itemTableName, (table) => {
      table.dropColumn('isRepair');
    });
  },
};
