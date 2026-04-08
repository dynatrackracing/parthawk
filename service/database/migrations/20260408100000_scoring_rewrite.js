'use strict';

exports.up = async function(knex) {
  // Add decoded_cylinders to yard_vehicle
  const hasCyl = await knex.schema.hasColumn('yard_vehicle', 'decoded_cylinders');
  if (!hasCyl) {
    await knex.schema.alterTable('yard_vehicle', (table) => {
      table.integer('decoded_cylinders');
    });
  }

  // Add match_score and match_reasons to scout_alerts
  const hasScore = await knex.schema.hasColumn('scout_alerts', 'match_score');
  if (!hasScore) {
    await knex.schema.alterTable('scout_alerts', (table) => {
      table.integer('match_score');
      table.jsonb('match_reasons').defaultTo('[]');
    });
    await knex.schema.alterTable('scout_alerts', (table) => {
      table.index('match_score', 'idx_scout_alerts_match_score');
    });
  }
};

exports.down = async function(knex) {
  const hasScore = await knex.schema.hasColumn('scout_alerts', 'match_score');
  if (hasScore) {
    await knex.schema.alterTable('scout_alerts', (table) => {
      table.dropIndex('match_score', 'idx_scout_alerts_match_score');
      table.dropColumn('match_reasons');
      table.dropColumn('match_score');
    });
  }
  const hasCyl = await knex.schema.hasColumn('yard_vehicle', 'decoded_cylinders');
  if (hasCyl) {
    await knex.schema.alterTable('yard_vehicle', (table) => {
      table.dropColumn('decoded_cylinders');
    });
  }
};
