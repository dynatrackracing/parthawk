'use strict';

module.exports = {
  async up(knex) {
    await knex.schema.alterTable('part_location', (table) => {
      table.text('body_style');
      table.text('confidence').defaultTo('researched'); // researched | field_confirmed | high_confidence
    });
  },

  async down(knex) {
    await knex.schema.alterTable('part_location', (table) => {
      table.dropColumn('body_style');
      table.dropColumn('confidence');
    });
  }
};
