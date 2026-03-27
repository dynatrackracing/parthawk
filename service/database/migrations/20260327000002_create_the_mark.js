'use strict';

exports.up = async function(knex) {
  await knex.schema.createTable('the_mark', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('normalizedTitle').notNullable().unique();
    table.text('originalTitle').notNullable();
    table.text('partNumber');
    table.text('partType');
    table.integer('medianPrice');
    table.text('sourceSignal');
    table.specificType('sourceSellers', 'text[]');
    table.integer('scoreAtMark');
    table.text('notes');
    table.boolean('active').defaultTo(true);
    table.timestamp('graduatedAt');
    table.text('graduatedReason');
    table.timestamp('markedAt').notNullable().defaultTo(knex.fn.now());
    table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updatedAt').notNullable().defaultTo(knex.fn.now());

    table.index('active');
    table.index('partType');
    table.index('markedAt');
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('the_mark');
};
