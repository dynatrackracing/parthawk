'use strict';

exports.up = async function(knex) {
  await knex.schema.alterTable('the_mark', (table) => {
    table.varchar('source', 32).defaultTo('PERCH');
    table.varchar('match_confidence', 16);
    table.integer('matched_yard_vehicle_id');
    table.timestamp('matched_at');
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('the_mark', (table) => {
    table.dropColumn('source');
    table.dropColumn('match_confidence');
    table.dropColumn('matched_yard_vehicle_id');
    table.dropColumn('matched_at');
  });
};
