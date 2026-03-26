exports.up = function(knex) {
  return knex.schema.createTable('fitment_intelligence', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('part_type').notNullable();
    table.text('make').notNullable();
    table.text('model').notNullable();
    table.integer('year_start').notNullable();
    table.integer('year_end').notNullable();
    table.jsonb('fits_trims').defaultTo('[]');
    table.jsonb('fits_engines').defaultTo('[]');
    table.jsonb('fits_transmissions').defaultTo('[]');
    table.jsonb('does_not_fit_trims').defaultTo('[]');
    table.jsonb('does_not_fit_engines').defaultTo('[]');
    table.jsonb('does_not_fit_transmissions').defaultTo('[]');
    table.jsonb('part_number_variants').defaultTo('{}');
    table.text('negation_text');
    table.text('part_number_warning');
    table.text('source_seller');
    table.jsonb('source_listings').defaultTo('[]');
    table.text('confidence').defaultTo('low');
    table.timestamp('scraped_at').defaultTo(knex.fn.now());
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.unique(['part_type', 'make', 'model', 'year_start', 'year_end']);
    table.index(['make', 'model', 'part_type'], 'idx_fitment_lookup');
    table.index(['year_start', 'year_end'], 'idx_fitment_year');
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('fitment_intelligence');
};
