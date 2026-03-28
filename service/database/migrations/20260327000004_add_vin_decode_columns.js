'use strict';

exports.up = async function(knex) {
  await knex.schema.alterTable('yard_vehicle', (table) => {
    table.text('decoded_trim');
    table.text('decoded_engine');
    table.text('decoded_drivetrain');
    table.text('trim_tier');
    table.timestamp('vin_decoded_at');
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('yard_vehicle', (table) => {
    table.dropColumn('decoded_trim');
    table.dropColumn('decoded_engine');
    table.dropColumn('decoded_drivetrain');
    table.dropColumn('trim_tier');
    table.dropColumn('vin_decoded_at');
  });
};
