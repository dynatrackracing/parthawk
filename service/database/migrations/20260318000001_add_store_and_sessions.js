'use strict';

module.exports = {
  async up(knex) {

    // Add store field to YourSale for multi-store tracking
    const hasStoreCol = await knex.schema.hasColumn('YourSale', 'store');
    if (!hasStoreCol) {
      await knex.schema.alterTable('YourSale', table => {
        table.text('store').defaultTo('dynatrack');
      });
    }

    // pull_session - per-visit session log with true COGS
    if (!await knex.schema.hasTable('pull_session')) {
      await knex.schema.createTable('pull_session', table => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.uuid('yard_id').references('id').inTable('yard').onDelete('SET NULL');
        table.text('puller_id');
        table.date('date').notNullable().defaultTo(knex.fn.now());
        table.decimal('parts_cost', 10, 2).defaultTo(0);
        table.decimal('gate_fee', 8, 2).defaultTo(0);
        table.decimal('tax_paid', 8, 2).defaultTo(0);
        table.decimal('mileage', 8, 2).defaultTo(0);
        table.decimal('total_true_cogs', 10, 2).defaultTo(0);
        table.decimal('total_market_value', 10, 2).defaultTo(0);
        table.decimal('blended_cogs_pct', 5, 2).defaultTo(0);
        table.integer('yield_rating');
        table.text('notes');
        table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());
        table.timestamp('updatedAt').notNullable().defaultTo(knex.fn.now());

        table.index('yard_id');
        table.index('date');
        table.index('puller_id');
      });
    }

    // dead_inventory - parts that failed to sell
    if (!await knex.schema.hasTable('dead_inventory')) {
      await knex.schema.createTable('dead_inventory', table => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.text('part_number_exact');
        table.text('part_number_base');
        table.text('description');
        table.text('vehicle_application');
        table.date('date_pulled');
        table.date('date_listed');
        table.integer('days_listed');
        table.boolean('sold').defaultTo(false);
        table.decimal('final_price', 10, 2);
        table.decimal('market_avg_at_time', 10, 2);
        table.decimal('price_vs_market', 5, 2);
        table.text('condition_grade');
        table.text('failure_reason');
        table.text('notes');
        table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());

        table.index('part_number_base');
        table.index('vehicle_application');
        table.index('failure_reason');
      });
    }

    // market_demand_cache - nightly market demand cache
    if (!await knex.schema.hasTable('market_demand_cache')) {
      await knex.schema.createTable('market_demand_cache', table => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.text('part_number_base').notNullable();
        table.integer('ebay_sold_90d').defaultTo(0);
        table.decimal('ebay_avg_price', 10, 2).defaultTo(0);
        table.integer('ebay_active_listings').defaultTo(0);
        table.decimal('market_score', 5, 2).defaultTo(0);
        table.timestamp('last_updated').defaultTo(knex.fn.now());
        table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());

        table.unique(['part_number_base'], 'idx_market_demand_base');
        table.index('last_updated');
        table.index('market_score');
      });
    }
  },

  async down(knex) {
    await knex.schema.dropTableIfExists('market_demand_cache');
    await knex.schema.dropTableIfExists('dead_inventory');
    await knex.schema.dropTableIfExists('pull_session');
  }
};
