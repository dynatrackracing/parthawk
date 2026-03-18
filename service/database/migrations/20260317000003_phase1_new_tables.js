'use strict';

module.exports = {
  async up(knex) {

    // vin_cache - never decode same VIN twice
    if (!await knex.schema.hasTable('vin_cache')) {
      await knex.schema.createTable('vin_cache', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.text('vin').notNullable().unique();
        table.integer('year');
        table.text('make');
        table.text('model');
        table.text('trim');
        table.text('engine');
        table.text('drivetrain');
        table.text('body_style');
        table.text('paint_code');
        table.jsonb('raw_nhtsa').defaultTo('{}');
        table.jsonb('raw_enriched').defaultTo('{}');
        table.timestamp('decoded_at').defaultTo(knex.fn.now());
        table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());
      });
      await knex.schema.alterTable('vin_cache', (table) => {
        table.index('vin', 'idx_vin_cache_vin');
      });
    }

    // trim_intelligence - cache trim package research permanently
    if (!await knex.schema.hasTable('trim_intelligence')) {
      await knex.schema.createTable('trim_intelligence', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.integer('year').notNullable();
        table.text('make').notNullable();
        table.text('model').notNullable();
        table.text('trim').notNullable();
        table.jsonb('expected_parts').defaultTo('[]');
        table.text('confidence').defaultTo('low');
        table.timestamp('researched_at').defaultTo(knex.fn.now());
        table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());
      });
      await knex.schema.alterTable('trim_intelligence', (table) => {
        table.unique(['year', 'make', 'model', 'trim'], 'idx_trim_intelligence_unique');
      });
    }

    // part_location - location and removal knowledge base
    if (!await knex.schema.hasTable('part_location')) {
      await knex.schema.createTable('part_location', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.text('part_type').notNullable();
        table.integer('year_start');
        table.integer('year_end');
        table.text('make');
        table.text('model');
        table.text('trim');
        table.text('location_text');
        table.jsonb('removal_steps').defaultTo('[]');
        table.text('tools');
        table.text('hazards');
        table.integer('avg_pull_minutes');
        table.text('photo_url');
        table.integer('confirmed_count').defaultTo(0);
        table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());
        table.timestamp('updatedAt').notNullable().defaultTo(knex.fn.now());
      });
      await knex.schema.alterTable('part_location', (table) => {
        table.index(['part_type', 'make', 'model'], 'idx_part_location_lookup');
      });
    }

    // dead_inventory - log for pull decision scoring
    if (!await knex.schema.hasTable('dead_inventory')) {
      await knex.schema.createTable('dead_inventory', (table) => {
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
      });
      await knex.schema.alterTable('dead_inventory', (table) => {
        table.index('part_number_base', 'idx_dead_inventory_part_base');
      });
    }

    // market_demand_cache - nightly market data for all sellers
    if (!await knex.schema.hasTable('market_demand_cache')) {
      await knex.schema.createTable('market_demand_cache', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.text('part_number_base').notNullable().unique();
        table.integer('ebay_sold_90d').defaultTo(0);
        table.decimal('ebay_avg_price', 10, 2);
        table.integer('ebay_active_listings').defaultTo(0);
        table.decimal('market_score', 5, 2);
        table.timestamp('last_updated').defaultTo(knex.fn.now());
        table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());
      });
      await knex.schema.alterTable('market_demand_cache', (table) => {
        table.index('part_number_base', 'idx_market_demand_part');
        table.index('last_updated', 'idx_market_demand_updated');
      });
    }

    // yard - yard profiles with cost data
    if (!await knex.schema.hasTable('yard')) {
      await knex.schema.createTable('yard', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.text('name').notNullable();
        table.text('chain');
        table.text('address');
        table.decimal('lat', 10, 6);
        table.decimal('lng', 10, 6);
        table.decimal('distance_from_base', 6, 1);
        table.decimal('entry_fee', 8, 2).defaultTo(0);
        table.text('entry_fee_notes');
        table.decimal('tax_rate', 5, 4).defaultTo(0);
        table.text('scrape_url');
        table.text('scrape_method');
        table.text('visit_frequency').defaultTo('on-demand');
        table.text('distance_category'); // local, day-trip, road-trip
        table.timestamp('last_scraped');
        table.timestamp('last_visited');
        table.decimal('avg_yield', 8, 2);
        table.decimal('avg_rating', 3, 2);
        table.boolean('flagged').defaultTo(false);
        table.text('flag_reason');
        table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());
        table.timestamp('updatedAt').notNullable().defaultTo(knex.fn.now());
      });
    }

    // pull_session - per-visit session log with true COGS
    if (!await knex.schema.hasTable('pull_session')) {
      await knex.schema.createTable('pull_session', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.uuid('yard_id').references('id').inTable('yard');
        table.text('puller_id');
        table.date('date').notNullable();
        table.decimal('parts_cost', 10, 2).defaultTo(0);
        table.decimal('gate_fee', 8, 2).defaultTo(0);
        table.decimal('tax_paid', 8, 2).defaultTo(0);
        table.decimal('mileage', 6, 1).defaultTo(0);
        table.decimal('mileage_cost', 8, 2).defaultTo(0);
        table.decimal('total_true_cogs', 10, 2).defaultTo(0);
        table.decimal('total_market_value', 10, 2).defaultTo(0);
        table.decimal('blended_cogs_pct', 5, 2).defaultTo(0);
        table.integer('yield_rating');
        table.text('notes');
        table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());
        table.timestamp('updatedAt').notNullable().defaultTo(knex.fn.now());
      });
    }

    // yard_visit_feedback - puller feedback per visit
    if (!await knex.schema.hasTable('yard_visit_feedback')) {
      await knex.schema.createTable('yard_visit_feedback', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.uuid('yard_id').references('id').inTable('yard');
        table.text('puller_id');
        table.date('visit_date').notNullable();
        table.integer('rating'); // 1-5
        table.text('notes');
        table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());
      });
    }

  },

  async down(knex) {
    await knex.schema.dropTableIfExists('yard_visit_feedback');
    await knex.schema.dropTableIfExists('pull_session');
    await knex.schema.dropTableIfExists('yard');
    await knex.schema.dropTableIfExists('market_demand_cache');
    await knex.schema.dropTableIfExists('dead_inventory');
    await knex.schema.dropTableIfExists('part_location');
    await knex.schema.dropTableIfExists('trim_intelligence');
    await knex.schema.dropTableIfExists('vin_cache');
  }
};
