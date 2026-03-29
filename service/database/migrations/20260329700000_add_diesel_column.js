'use strict';

exports.up = async function(knex) {
  // Add diesel column to trim_tier_reference
  const hasDieselRef = await knex.schema.hasColumn('trim_tier_reference', 'diesel');
  if (!hasDieselRef) {
    await knex.schema.alterTable('trim_tier_reference', table => {
      table.boolean('diesel').defaultTo(false);
    });
  }

  // Flag existing diesel entries by engine string
  await knex.raw(`UPDATE trim_tier_reference SET diesel = true WHERE LOWER(top_engine) LIKE '%diesel%' OR LOWER(top_engine) LIKE '%cummins%' OR LOWER(top_engine) LIKE '%duramax%' OR LOWER(top_engine) LIKE '%power stroke%' OR LOWER(top_engine) LIKE '%tdi%'`);

  // Add diesel column to yard_vehicle
  const hasDieselYard = await knex.schema.hasColumn('yard_vehicle', 'diesel');
  if (!hasDieselYard) {
    await knex.schema.alterTable('yard_vehicle', table => {
      table.boolean('diesel').defaultTo(false);
    });
  }
};

exports.down = async function(knex) {
  await knex.schema.alterTable('trim_tier_reference', table => {
    table.dropColumn('diesel');
  });
  await knex.schema.alterTable('yard_vehicle', table => {
    table.dropColumn('diesel');
  });
};
