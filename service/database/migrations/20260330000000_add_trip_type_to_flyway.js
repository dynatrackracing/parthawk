'use strict';

exports.up = async function(knex) {
  await knex.schema.alterTable('flyway_trip', (table) => {
    table.string('trip_type', 20).notNullable().defaultTo('road_trip');
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('flyway_trip', (table) => {
    table.dropColumn('trip_type');
  });
};
