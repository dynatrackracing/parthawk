'use strict';

/**
 * Phase 2-5 schema additions:
 * - stale_inventory_action: log of automated price reductions
 * - return_intake: returned parts intake + auto-relist queue
 * - restock_flag: parts that need restocking
 * - competitor_alert: competitor price monitoring alerts
 * - Add store column to YourListing for multi-store
 * - Add programmed flag to YourListing for price protection
 * - Add seasonal_weight to market_demand_cache
 */

module.exports = {
  async up(knex) {

    // stale_inventory_action - log of automated/manual price actions
    if (!await knex.schema.hasTable('stale_inventory_action')) {
      await knex.schema.createTable('stale_inventory_action', table => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.text('ebay_item_id').notNullable();
        table.text('listing_id'); // FK to YourListing.id
        table.text('title');
        table.text('action_type').notNullable(); // price_reduction, relist, end_listing
        table.decimal('old_price', 10, 2);
        table.decimal('new_price', 10, 2);
        table.integer('days_listed');
        table.text('tier'); // 60, 90, 120, 180, 270
        table.boolean('programmed_listing').defaultTo(false);
        table.boolean('executed').defaultTo(false);
        table.text('execution_error');
        table.text('notes');
        table.timestamp('scheduled_at').defaultTo(knex.fn.now());
        table.timestamp('executed_at');
        table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());

        table.index('ebay_item_id');
        table.index('action_type');
        table.index('executed');
      });
    }

    // return_intake - returned parts log + auto-relist queue
    if (!await knex.schema.hasTable('return_intake')) {
      await knex.schema.createTable('return_intake', table => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.text('ebay_item_id');
        table.text('listing_id'); // FK to YourListing
        table.text('title');
        table.text('part_number');
        table.text('sku');
        table.text('puller_name');
        table.text('yard_name');
        table.text('vehicle_info'); // year make model
        table.text('condition_grade').notNullable(); // A, B, C
        table.text('condition_notes');
        table.decimal('original_price', 10, 2);
        table.decimal('relist_price', 10, 2);
        table.text('relist_status').defaultTo('pending'); // pending, relisted, scrapped
        table.text('relist_ebay_item_id');
        table.timestamp('returned_at').defaultTo(knex.fn.now());
        table.timestamp('relisted_at');
        table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());

        table.index('relist_status');
        table.index('condition_grade');
      });
    }

    // restock_flag - parts that need restocking
    if (!await knex.schema.hasTable('restock_flag')) {
      await knex.schema.createTable('restock_flag', table => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.text('part_number_base').notNullable();
        table.text('title');
        table.text('category');
        table.integer('sold_90d').defaultTo(0);
        table.integer('sold_30d').defaultTo(0);
        table.integer('active_stock').defaultTo(0);
        table.decimal('avg_sold_price', 10, 2);
        table.decimal('avg_days_to_sell', 8, 2);
        table.decimal('restock_score', 5, 2);
        table.text('store').defaultTo('all'); // dynatrack, autolumen, all
        table.boolean('acknowledged').defaultTo(false);
        table.timestamp('last_checked').defaultTo(knex.fn.now());
        table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());

        table.unique(['part_number_base', 'store'], 'idx_restock_unique');
        table.index('restock_score');
        table.index('acknowledged');
      });
    }

    // competitor_alert - competitor price monitoring
    if (!await knex.schema.hasTable('competitor_alert')) {
      await knex.schema.createTable('competitor_alert', table => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.text('competitor_seller');
        table.text('part_number_base');
        table.text('title');
        table.text('alert_type').notNullable(); // underpriced, competitor_dropped, new_competitor
        table.decimal('our_price', 10, 2);
        table.decimal('competitor_price', 10, 2);
        table.decimal('market_avg', 10, 2);
        table.text('recommendation');
        table.boolean('dismissed').defaultTo(false);
        table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());

        table.index('alert_type');
        table.index('dismissed');
        table.index('competitor_seller');
      });
    }

    // Add store column to YourListing if not exists
    const hasListingStore = await knex.schema.hasColumn('YourListing', 'store');
    if (!hasListingStore) {
      await knex.schema.alterTable('YourListing', table => {
        table.text('store').defaultTo('dynatrack');
      });
    }

    // Add programmed flag to YourListing for price protection
    const hasProgrammed = await knex.schema.hasColumn('YourListing', 'isProgrammed');
    if (!hasProgrammed) {
      await knex.schema.alterTable('YourListing', table => {
        table.boolean('isProgrammed').defaultTo(false);
      });
    }

    // Add seasonal_weight to market_demand_cache if not exists
    const hasSeasonalWeight = await knex.schema.hasColumn('market_demand_cache', 'seasonal_weight');
    if (!hasSeasonalWeight) {
      await knex.schema.alterTable('market_demand_cache', table => {
        table.decimal('ebay_sold_30d', 10, 0).defaultTo(0);
        table.decimal('seasonal_weight', 5, 2).defaultTo(1.0);
      });
    }

    // Add entry_fee_notes to yard if not exists
    const hasEntryNotes = await knex.schema.hasColumn('yard', 'entry_fee_notes');
    if (!hasEntryNotes) {
      await knex.schema.alterTable('yard', table => {
        table.text('entry_fee_notes');
      });
    }
  },

  async down(knex) {
    await knex.schema.dropTableIfExists('competitor_alert');
    await knex.schema.dropTableIfExists('restock_flag');
    await knex.schema.dropTableIfExists('return_intake');
    await knex.schema.dropTableIfExists('stale_inventory_action');
  }
};
