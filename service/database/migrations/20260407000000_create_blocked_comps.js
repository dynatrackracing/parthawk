'use strict';

exports.up = async function(knex) {
  await knex.schema.createTable('blocked_comps', (table) => {
    table.increments('id').primary();
    table.string('source_item_id', 64).notNullable().unique();
    table.text('source_title');
    table.string('source_part_number', 128);
    table.string('source_category', 128);
    table.text('blocked_reason');
    table.timestamp('blocked_at').notNullable().defaultTo(knex.fn.now());
    table.string('blocked_by', 128);
  });
  await knex.raw('CREATE INDEX idx_blocked_comps_pn ON blocked_comps(source_part_number)');
  await knex.raw('CREATE INDEX idx_blocked_comps_blocked_at ON blocked_comps(blocked_at DESC)');
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('blocked_comps');
};
