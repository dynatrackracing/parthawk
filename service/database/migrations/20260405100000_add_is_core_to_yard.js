'use strict';

exports.up = async function(knex) {
  const hasCol = await knex.schema.hasColumn('yard', 'is_core');
  if (!hasCol) {
    await knex.schema.alterTable('yard', (table) => {
      table.boolean('is_core').defaultTo(false);
    });
  }

  // Mark local NC pull yards as core — these always generate scout alerts
  // regardless of Flyway trip status
  const corePatterns = [
    'LKQ Raleigh', 'LKQ Durham', 'LKQ Greensboro', 'LKQ East NC',
    'Foss U-Pull-It La Grange', 'Foss U-Pull-It Jacksonville',
    "Young's U-Pull-It Goldsboro",
  ];
  for (const name of corePatterns) {
    await knex('yard').where('name', name).update({ is_core: true });
  }
};

exports.down = async function(knex) {
  const hasCol = await knex.schema.hasColumn('yard', 'is_core');
  if (hasCol) {
    await knex.schema.alterTable('yard', (table) => {
      table.dropColumn('is_core');
    });
  }
};
