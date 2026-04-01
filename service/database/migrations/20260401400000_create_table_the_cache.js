'use strict';

exports.up = async function(knex) {
  await knex.schema.createTable('the_cache', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    // What was claimed
    table.string('part_type', 100);
    table.text('part_description');
    table.string('part_number', 100);

    // From what vehicle (nullable for manual PN-only entries)
    table.integer('vehicle_year');
    table.string('vehicle_make', 100);
    table.string('vehicle_model', 100);
    table.string('vehicle_trim', 100);
    table.string('vehicle_vin', 17);

    // Where (nullable for manual entries not tied to a yard)
    table.string('yard_name', 200);
    table.string('row_number', 50);

    // Value at time of claim
    table.decimal('estimated_value', 10, 2);
    table.string('price_source', 50);

    // Who and when
    table.string('claimed_by', 100).defaultTo('ry');
    table.timestamp('claimed_at').defaultTo(knex.fn.now());

    // Source: which tool created this
    table.string('source', 50).notNullable();
    table.string('source_id', 255);

    // Status
    table.string('status', 30).defaultTo('claimed');

    // Resolution
    table.timestamp('resolved_at');
    table.string('resolved_by', 50);
    table.string('ebay_item_id', 50);

    table.text('notes');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    // Indexes
    table.index('status', 'idx_cache_status');
    table.index(['source', 'source_id'], 'idx_cache_source');
    table.index('part_number', 'idx_cache_part_number');
    table.index('claimed_at', 'idx_cache_claimed_at');
    table.index(['vehicle_make', 'vehicle_model', 'vehicle_year'], 'idx_cache_vehicle');
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('the_cache');
};
