'use strict';

exports.up = async function(knex) {
  await knex.schema.alterTable('the_mark', (table) => {
    table.integer('year_start');
    table.integer('year_end');
    table.varchar('make', 64);
    table.varchar('model', 64);
    table.boolean('needs_review').defaultTo(false);
  });

  await knex.schema.alterTable('the_mark', (table) => {
    table.index('needs_review');
    table.index(['make', 'model']);
    table.index(['year_start', 'year_end']);
  });

  // Backfill existing marks
  const { extractMarkVehicle } = require('../../lib/markVehicleExtractor');
  const marks = await knex('the_mark').select('id', 'originalTitle');

  for (const mark of marks) {
    const v = extractMarkVehicle(mark.originalTitle);
    await knex('the_mark')
      .where('id', mark.id)
      .update({
        year_start: v.year_start,
        year_end: v.year_end,
        make: v.make,
        model: v.model,
        needs_review: v.needs_review,
        updatedAt: new Date(),
      });
  }

  console.log(`[migration] Backfilled ${marks.length} marks with structured vehicle fields`);
};

exports.down = async function(knex) {
  await knex.schema.alterTable('the_mark', (table) => {
    table.dropIndex(['year_start', 'year_end']);
    table.dropIndex(['make', 'model']);
    table.dropIndex('needs_review');
    table.dropColumn('needs_review');
    table.dropColumn('model');
    table.dropColumn('make');
    table.dropColumn('year_end');
    table.dropColumn('year_start');
  });
};
