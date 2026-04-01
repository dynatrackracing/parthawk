'use strict';

exports.up = async function(knex) {
  await knex.schema.createTable('scrape_log', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('yard_id').references('id').inTable('yard');
    table.timestamp('scraped_at').defaultTo(knex.fn.now());
    table.integer('vehicles_found').defaultTo(0);
    table.integer('new_vehicles').defaultTo(0);
    table.integer('pages_scraped').defaultTo(0);
    table.text('termination_reason');
    table.text('source').defaultTo('local');
    table.index('yard_id');
    table.index('scraped_at');
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('scrape_log');
};
