'use strict';

const tableName = 'trim_catalog';

module.exports = {
  async up(knex) {
    const exists = await knex.schema.hasTable(tableName);
    if (exists) return;

    await knex.schema.createTable(tableName, (table) => {
      table.increments('id').primary();
      table.integer('year').notNullable();
      table.text('make').notNullable();
      table.text('model').notNullable();
      table.text('trim_raw').notNullable();
      table.text('trim_name').notNullable();
      table.text('body_style');
      table.text('tier').notNullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    });

    await knex.raw(`CREATE INDEX idx_trim_catalog_ymm ON ${tableName} (year, make, model)`);
    await knex.raw(`CREATE INDEX idx_trim_catalog_tier ON ${tableName} (tier)`);
    await knex.raw(`CREATE UNIQUE INDEX idx_trim_catalog_unique ON ${tableName} (year, make, model, trim_raw)`);

    await knex.schema.createTable('trim_catalog_tracked', (table) => {
      table.increments('id').primary();
      table.integer('year').notNullable();
      table.text('make').notNullable();
      table.text('model').notNullable();
      table.integer('trim_count').defaultTo(0);
      table.timestamp('cataloged_at').notNullable().defaultTo(knex.fn.now());
    });

    await knex.raw(`CREATE UNIQUE INDEX idx_trim_tracked_ymm ON trim_catalog_tracked (year, make, model)`);
  },

  async down(knex) {
    await knex.schema.dropTableIfExists('trim_catalog_tracked');
    await knex.schema.dropTableIfExists(tableName);
  },
};
