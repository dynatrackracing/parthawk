'use strict';

/**
 * Market Intelligence Tables
 *
 * This migration creates tables for comprehensive market research:
 * - MarketResearchRun: Tracks scraping jobs per inventory item
 * - CompetitorListing: Active listings from competitors
 * - Updates SoldItem to link to our inventory
 * - PriceSnapshot: Aggregated price data for ML training
 */

exports.up = async function(knex) {
  // Market research run - tracks each scraping job
  await knex.schema.createTable('MarketResearchRun', (table) => {
    table.uuid('id').primary();
    table.uuid('yourListingId').references('id').inTable('YourListing').onDelete('CASCADE');
    table.text('keywords').notNullable();
    table.string('status', 50).defaultTo('pending');
    table.timestamp('startedAt');
    table.timestamp('completedAt');
    table.integer('activeListingsFound').defaultTo(0);
    table.integer('soldItemsFound').defaultTo(0);
    table.text('errorMessage');
    table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());

    table.index('yourListingId');
    table.index('status');
    table.index('createdAt');
  });

  // Competitor listings - active listings from other sellers
  await knex.schema.createTable('CompetitorListing', (table) => {
    table.uuid('id').primary();
    table.uuid('researchRunId').references('id').inTable('MarketResearchRun').onDelete('SET NULL');
    table.uuid('yourListingId').references('id').inTable('YourListing').onDelete('SET NULL');
    table.string('ebayItemId', 50).notNullable();
    table.text('title').notNullable();
    table.decimal('currentPrice', 10, 2).notNullable();
    table.decimal('originalPrice', 10, 2);
    table.string('seller', 255);
    table.integer('sellerFeedbackScore');
    table.decimal('sellerFeedbackPercent', 5, 2);
    table.string('condition', 100);
    table.decimal('shippingCost', 10, 2);
    table.boolean('freeShipping').defaultTo(false);
    table.boolean('freeReturns').defaultTo(false);
    table.string('location', 255);
    table.boolean('isSponsored').defaultTo(false);
    table.text('pictureUrl');
    table.text('viewItemUrl');
    table.text('keywords');
    table.timestamp('scrapedAt').notNullable().defaultTo(knex.fn.now());
    table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());

    table.unique('ebayItemId');
    table.index('yourListingId');
    table.index('seller');
    table.index('currentPrice');
    table.index('scrapedAt');
  });

  // Add columns to SoldItem to link to our inventory
  await knex.schema.alterTable('SoldItem', (table) => {
    table.uuid('researchRunId').references('id').inTable('MarketResearchRun').onDelete('SET NULL');
    table.uuid('yourListingId').references('id').inTable('YourListing').onDelete('SET NULL');
    table.text('keywords');
    table.decimal('originalPrice', 10, 2);
    table.integer('sellerFeedbackScore');
    table.decimal('sellerFeedbackPercent', 5, 2);
    table.decimal('shippingCost', 10, 2);
    table.boolean('freeShipping').defaultTo(false);
    table.string('location', 255);
    table.timestamp('scrapedAt').defaultTo(knex.fn.now());

    table.index('yourListingId');
  });

  // Price history for ML training - aggregated snapshots
  await knex.schema.createTable('PriceSnapshot', (table) => {
    table.uuid('id').primary();
    table.text('keywords').notNullable();
    table.string('categoryId', 50);
    table.integer('soldCount').defaultTo(0);
    table.decimal('soldPriceMin', 10, 2);
    table.decimal('soldPriceMax', 10, 2);
    table.decimal('soldPriceAvg', 10, 2);
    table.decimal('soldPriceMedian', 10, 2);
    table.integer('activeCount').defaultTo(0);
    table.decimal('activePriceMin', 10, 2);
    table.decimal('activePriceMax', 10, 2);
    table.decimal('activePriceAvg', 10, 2);
    table.decimal('activePriceMedian', 10, 2);
    table.timestamp('periodStart').notNullable();
    table.timestamp('periodEnd').notNullable();
    table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());

    table.index(['keywords', 'periodStart']);
    table.index('createdAt');
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('SoldItem', (table) => {
    table.dropColumn('researchRunId');
    table.dropColumn('yourListingId');
    table.dropColumn('keywords');
    table.dropColumn('originalPrice');
    table.dropColumn('sellerFeedbackScore');
    table.dropColumn('sellerFeedbackPercent');
    table.dropColumn('shippingCost');
    table.dropColumn('freeShipping');
    table.dropColumn('location');
    table.dropColumn('scrapedAt');
  });

  await knex.schema.dropTableIfExists('PriceSnapshot');
  await knex.schema.dropTableIfExists('CompetitorListing');
  await knex.schema.dropTableIfExists('MarketResearchRun');
};
