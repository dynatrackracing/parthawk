'use strict';

exports.up = async function(knex) {
  await knex.schema.alterTable('flyway_trip', (table) => {
    table.timestamp('completed_at').nullable();
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('flyway_trip', (table) => {
    table.dropColumn('completed_at');
  });
};
