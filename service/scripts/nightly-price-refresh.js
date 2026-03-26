#!/usr/bin/env node
/**
 * DARKHAWK — Nightly Price Refresh
 *
 * Queries YourSale for top 200 most-sold title patterns (last 180 days),
 * scrapes eBay sold comps for each via PriceCheckServiceV2, and upserts
 * results into market_demand_cache.
 *
 * Schedule: 4 AM daily via Task Scheduler or cron alongside LKQ scrape.
 * Usage: node service/scripts/nightly-price-refresh.js
 */

'use strict';

const path = require('path');
process.chdir(path.resolve(__dirname, '..', '..'));
require('dotenv').config();

const { database } = require('../database/database');
const priceCheck = require('../services/PriceCheckServiceV2');

const DELAY_MS = 3000; // 3s between scrapes to avoid eBay rate limiting
const MAX_PARTS = 200;
const DAYS_BACK = 180;

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('DARKHAWK — Nightly Price Refresh');
  console.log(new Date().toISOString());
  console.log('═══════════════════════════════════════════\n');

  // Step 1: Get top 200 most-sold title patterns
  console.log('1. Querying top sellers from YourSale (last ' + DAYS_BACK + ' days)...');
  const topSellers = await database.raw(`
    SELECT
      SUBSTRING(title FROM 1 FOR 80) as part_desc,
      COUNT(*) as sold_count,
      ROUND(AVG("salePrice")::numeric, 2) as avg_price,
      MAX("soldDate") as last_sold
    FROM "YourSale"
    WHERE "soldDate" > NOW() - INTERVAL '${DAYS_BACK} days'
      AND title IS NOT NULL
      AND "salePrice" > 50
    GROUP BY SUBSTRING(title FROM 1 FOR 80)
    HAVING COUNT(*) >= 2
    ORDER BY COUNT(*) DESC
    LIMIT ${MAX_PARTS}
  `);

  const parts = topSellers.rows || topSellers;
  console.log('   Found ' + parts.length + ' title patterns to refresh\n');

  if (parts.length === 0) {
    console.log('   No parts to refresh. Exiting.');
    await database.destroy();
    return;
  }

  // Step 2: Scrape comps for each
  let refreshed = 0, failed = 0, skipped = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const title = part.part_desc;

    try {
      process.stdout.write(`\r   [${i + 1}/${parts.length}] ${title.substring(0, 50)}...`);

      const result = await priceCheck.check(title, parseFloat(part.avg_price) || 0);

      if (result.metrics.count === 0) {
        skipped++;
        await new Promise(r => setTimeout(r, DELAY_MS));
        continue;
      }

      // Upsert into market_demand_cache
      await database.raw(`
        INSERT INTO market_demand_cache
          (id, part_number_base, ebay_avg_price, ebay_sold_90d, last_updated, "createdAt")
        VALUES (gen_random_uuid(), ?, ?, ?, NOW(), NOW())
        ON CONFLICT (part_number_base)
        DO UPDATE SET
          ebay_avg_price = EXCLUDED.ebay_avg_price,
          ebay_sold_90d = EXCLUDED.ebay_sold_90d,
          last_updated = NOW()
      `, [
        title.substring(0, 80).toUpperCase().replace(/\s+/g, ' ').trim(),
        result.metrics.median,
        result.metrics.count,
      ]);

      refreshed++;
    } catch (err) {
      failed++;
      if (failed <= 5) console.error(`\n   ERROR on "${title.substring(0, 40)}": ${err.message}`);
    }

    // Rate limit
    if (i < parts.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  // Step 3: Summary
  const { rows: [stats] } = await database.raw(`
    SELECT COUNT(*) as total, COUNT(CASE WHEN ebay_avg_price > 0 THEN 1 END) as with_price
    FROM market_demand_cache
  `);

  console.log('\n\n═══════════════════════════════════════════');
  console.log('COMPLETE');
  console.log('  Refreshed: ' + refreshed);
  console.log('  Skipped:   ' + skipped + ' (no comps found)');
  console.log('  Failed:    ' + failed);
  console.log('  Cache now: ' + stats.total + ' total (' + stats.with_price + ' with prices)');
  console.log('═══════════════════════════════════════════');

  await database.destroy();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
