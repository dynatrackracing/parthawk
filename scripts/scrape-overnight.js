'use strict';

/**
 * OVERNIGHT SCRAPE — LKQ Huntsville, Pull-A-Part Knoxville, Pull-A-Part Birmingham
 *
 * Usage: node scripts/scrape-overnight.js
 *   or:  DATABASE_URL=... node scripts/scrape-overnight.js
 */

const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') }); } catch (e) {}

const LKQScraper = require('../service/scrapers/LKQScraper');
const PullAPartScraper = require('../service/scrapers/PullAPartScraper');
const { enrichYard } = require('../service/services/PostScrapeService');

async function main() {
  console.log('=== OVERNIGHT SCRAPE ===');
  console.log('Time: ' + new Date().toISOString() + '\n');

  const { database } = require('../service/database/database');

  const yards = await database('yard')
    .where('name', 'ilike', '%huntsville%')
    .orWhere('name', 'ilike', '%knoxville%')
    .orWhere('name', 'ilike', '%birmingham%')
    .where('enabled', true)
    .orderBy('distance_from_base', 'asc');

  console.log('Found ' + yards.length + ' yards: ' + yards.map(y => y.name).join(', ') + '\n');

  for (const yard of yards) {
    console.log('━━━ ' + yard.name + ' ━━━');
    try {
      let result;

      if (yard.chain === 'LKQ') {
        // LKQScraper.scrapeLocation() takes a location object { name, slug, storeId }
        // Extract slug from scrape_url: https://www.pyp.com/inventory/huntsville-1223/
        const slugMatch = (yard.scrape_url || '').match(/\/inventory\/([^/]+)/);
        const slug = slugMatch ? slugMatch[1] : null;
        const storeIdMatch = slug ? slug.match(/-(\d+)$/) : null;
        const storeId = storeIdMatch ? storeIdMatch[1] : null;

        if (!slug) {
          console.error('  No slug found in scrape_url: ' + yard.scrape_url);
          continue;
        }

        const scraper = new LKQScraper();
        const location = { name: yard.name, slug, storeId };
        console.log('  LKQ slug: ' + slug + ', storeId: ' + storeId);
        result = await scraper.scrapeLocation(location);
      } else {
        // PullAPartScraper.scrapeYard() takes a full yard DB object
        const scraper = new PullAPartScraper();
        result = await scraper.scrapeYard(yard);
      }

      console.log('  Total: ' + (result.total || 0) + ' | Inserted: ' + (result.inserted || 0) + ' | Updated: ' + (result.updated || 0));

      // Enrichment — enrichYard is a plain function, not a class method
      console.log('  Running enrichment...');
      const enrichStats = await enrichYard(yard.id);
      console.log('  Enriched: ' + enrichStats.vinsDecoded + ' VINs, ' + enrichStats.trimsTiered + ' trims, ' + enrichStats.errors + ' errors');
    } catch (err) {
      console.error('  FAILED: ' + err.message);
    }

    console.log('  Waiting 5s...\n');
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log('=== OVERNIGHT SCRAPE COMPLETE ===');
  await database.destroy();
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
