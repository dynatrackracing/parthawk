'use strict';

exports.up = async function(knex) {
  await knex.schema.alterTable('flyway_trip', (table) => {
    table.boolean('cleaned_up').defaultTo(false);
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('flyway_trip', (table) => {
    table.dropColumn('cleaned_up');
  });
};
