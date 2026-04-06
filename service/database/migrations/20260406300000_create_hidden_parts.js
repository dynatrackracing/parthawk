'use strict';

exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('hidden_parts');
  if (exists) return;
  await knex.schema.createTable('hidden_parts', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('part_number_base').notNullable();
    table.text('part_type').nullable();
    table.text('make').nullable();
    table.text('model').nullable();
    table.text('source').notNullable(); // 'perch', 'sky', 'quarry', 'manual'
    table.jsonb('source_detail').nullable();
    table.text('hidden_by').defaultTo('user');
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });
  await knex.raw("CREATE UNIQUE INDEX IF NOT EXISTS idx_hidden_parts_key ON hidden_parts(part_number_base, COALESCE(make,''), COALESCE(model,''))");
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('hidden_parts');
};
