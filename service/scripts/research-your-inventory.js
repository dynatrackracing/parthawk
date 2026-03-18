'use strict';

/**
 * Research Your Inventory Script
 *
 * Scrapes competitor listings and sold items for YOUR actual eBay listings.
 * Links all scraped data to your specific listings via yourListingId.
 *
 * This is the correct data pipeline:
 * 1. Get YOUR listings from YourListing table
 * 2. For each listing, extract keywords from title
 * 3. Scrape eBay for matching competitors and sold items
 * 4. Store data LINKED to your listing ID
 * 5. Enable ML pricing analysis on YOUR items
 *
 * Usage: node service/scripts/research-your-inventory.js [options]
 *   --min-price=100    Only research items priced at $100+ (default: 100)
 *   --limit=50         Max items to process per run (default: 50)
 *   --skip-researched  Skip items researched in last 24h (default: true)
 */

// Initialize database connection
const { Model } = require('objection');
const { database } = require('../database/database');
Model.knex(database);

const MarketResearchManager = require('../managers/MarketResearchManager');
const YourListing = require('../models/YourListing');
const MarketResearchRun = require('../models/MarketResearchRun');
const CompetitorListing = require('../models/CompetitorListing');
const SoldItem = require('../models/SoldItem');
const { log } = require('../lib/logger');

async function researchYourInventory(options = {}) {
  const {
    minPrice = 100,
    limit = 50,
    skipResearched = true,
    maxActivePages = 2,
    maxSoldPages = 3,
    categoryId = '6030', // Auto Parts
  } = options;

  console.log(`\n=== Research Your Inventory ===`);
  console.log(`Min price filter: $${minPrice}`);
  console.log(`Max items per run: ${limit}`);
  console.log(`Skip recently researched: ${skipResearched}`);
  console.log(`Category ID: ${categoryId}\n`);

  // Get YOUR listings that need research
  let query = YourListing.query()
    .where('currentPrice', '>=', minPrice)
    .orderBy('currentPrice', 'desc') // Start with highest value items
    .limit(limit);

  // Skip items researched in last 24 hours
  if (skipResearched) {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    query = query.whereNotExists(
      MarketResearchRun.query()
        .whereColumn('MarketResearchRun.yourListingId', 'YourListing.id')
        .where('MarketResearchRun.createdAt', '>', oneDayAgo)
        .where('MarketResearchRun.status', 'completed')
    );
  }

  const listings = await query;

  console.log(`Found ${listings.length} listings to research\n`);

  if (listings.length === 0) {
    console.log('No listings need research. Try with --skip-researched=false');
    return { processed: 0, competitors: 0, soldItems: 0, errors: 0 };
  }

  // Show sample of what we're researching
  console.log('Sample listings to research:');
  listings.slice(0, 5).forEach((l, i) => {
    console.log(`  ${i + 1}. $${l.currentPrice} - ${l.title.substring(0, 60)}...`);
  });
  console.log('');

  const manager = new MarketResearchManager();
  const results = {
    processed: 0,
    competitors: 0,
    soldItems: 0,
    errors: 0,
    skipped: 0,
  };

  for (let i = 0; i < listings.length; i++) {
    const listing = listings[i];
    console.log(`[${i + 1}/${listings.length}] $${listing.currentPrice} - ${listing.title.substring(0, 50)}...`);

    try {
      // Research this specific listing
      const research = await manager.researchSingleItem({
        listing,
        maxActivePages,
        maxSoldPages,
        categoryId,
      });

      results.processed++;
      results.competitors += research.activeListings;
      results.soldItems += research.soldItems;

      console.log(`    ✓ Found ${research.activeListings} competitors, ${research.soldItems} sold items`);

      // Delay between items to avoid detection
      if (i < listings.length - 1) {
        const delay = 8000 + Math.random() * 4000; // 8-12 seconds
        console.log(`    Waiting ${(delay / 1000).toFixed(1)}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } catch (err) {
      console.error(`    ✗ Error: ${err.message}`);
      results.errors++;

      // If we get blocked, wait longer
      if (err.message.includes('blocked') || err.message.includes('captcha')) {
        console.log('    Detected possible blocking, waiting 30s...');
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
    }
  }

  // Close browser
  await manager.scraper.closeBrowser();

  console.log(`\n=== Research Complete ===`);
  console.log(`Listings processed: ${results.processed}/${listings.length}`);
  console.log(`Competitors found: ${results.competitors}`);
  console.log(`Sold items found: ${results.soldItems}`);
  console.log(`Errors: ${results.errors}`);

  // Show summary of linked data
  const linkedCompetitors = await CompetitorListing.query()
    .whereNotNull('yourListingId')
    .count('* as count')
    .first();
  const linkedSold = await SoldItem.query()
    .whereNotNull('yourListingId')
    .count('* as count')
    .first();

  console.log(`\nTotal linked data in DB:`);
  console.log(`  Competitor listings: ${linkedCompetitors.count}`);
  console.log(`  Sold items: ${linkedSold.count}`);

  return results;
}

// Parse CLI arguments
function parseArgs(args) {
  const options = {};
  args.forEach(arg => {
    if (arg.startsWith('--')) {
      const [key, value] = arg.substring(2).split('=');
      if (value === 'true') options[key.replace(/-/g, '')] = true;
      else if (value === 'false') options[key.replace(/-/g, '')] = false;
      else if (!isNaN(value)) options[key.replace(/-/g, '')] = parseFloat(value);
      else options[key.replace(/-/g, '')] = value;
    }
  });
  return options;
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  const knexConfig = require('../database/knexfile');
  const migrationConfig = knexConfig[process.env.NODE_ENV || 'development'];

  database.migrate.latest(migrationConfig.migration)
    .then(() => researchYourInventory({
      minPrice: options.minprice || 100,
      limit: options.limit || 50,
      skipResearched: options.skipresearched !== false,
      maxActivePages: options.activepages || 2,
      maxSoldPages: options.soldpages || 3,
    }))
    .then(() => {
      console.log('\nDone!');
      process.exit(0);
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { researchYourInventory };
