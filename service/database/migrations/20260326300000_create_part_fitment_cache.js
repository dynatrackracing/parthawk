exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('part_fitment_cache');
  if (exists) return;
  return knex.schema.createTable('part_fitment_cache', (table) => {
    table.increments('id').primary();
    table.string('part_number_exact', 50).notNullable();
    table.string('part_number_base', 50).notNullable().unique();
    table.text('part_name');
    table.string('part_type', 30);
    table.integer('year');
    table.string('year_range', 20);
    table.string('make', 50);
    table.string('model', 50);
    table.string('engine', 50);
    table.string('trim', 50);
    table.string('drivetrain', 30);
    table.text('does_not_fit');
    table.string('programming_required', 20);
    table.text('programming_note');
    table.string('source', 30).defaultTo('listing_tool');
    table.timestamp('confirmed_at').defaultTo(knex.fn.now());
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.index('part_number_base', 'idx_pfc_pn_base');
    table.index(['make', 'model'], 'idx_pfc_make_model');
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('part_fitment_cache');
};
