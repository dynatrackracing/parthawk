#!/usr/bin/env node
/**
 * DARKHAWK — Nightly Price Refresh
 *
 * Pre-warms market_demand_cache with the EXACT keys that the attack list
 * enrichment reads via MarketPricingService.getCachedPrice().
 *
 * Strategy: query distinct make/model/partType combos from YourSale (last 180d),
 * build cache keys using MarketPricingService.buildSearchQuery() so they match
 * what getAttackList() and /vehicle/:id/parts look up.
 *
 * Schedule: 4 AM daily via Task Scheduler or cron alongside LKQ scrape.
 * Usage:   node service/scripts/nightly-price-refresh.js [--limit N] [--test]
 */

'use strict';

const path = require('path');
process.chdir(path.resolve(__dirname, '..', '..'));
require('dotenv').config();

const { database } = require('../database/database');
const priceCheck = require('../services/PriceCheckServiceV2');
const { buildSearchQuery } = require('../services/MarketPricingService');
const { extractPartNumbers } = require('../utils/partIntelligence');

const DELAY_MS = 3000; // 3s between scrapes to avoid eBay rate limiting
const DAYS_BACK = 180;

// Parse CLI args
const args = process.argv.slice(2);
const testMode = args.includes('--test');
const limitIdx = args.indexOf('--limit');
const MAX_PARTS = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || 200 : (testMode ? 10 : 200);

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('DARKHAWK — Nightly Price Refresh');
  console.log(new Date().toISOString());
  if (testMode) console.log('** TEST MODE — limit ' + MAX_PARTS + ' parts **');
  console.log('═══════════════════════════════════════════\n');

  // Step 1: Get distinct make/model/partType combos from YourSale
  // These are the combos that scoreVehicle() produces and getAttackList() enriches
  console.log('1. Querying distinct part combos from YourSale (last ' + DAYS_BACK + ' days)...');

  const combos = await database.raw(`
    SELECT
      title,
      "salePrice",
      COUNT(*) OVER (PARTITION BY SUBSTRING(title FROM 1 FOR 80)) as combo_count
    FROM "YourSale"
    WHERE "soldDate" > NOW() - INTERVAL '${DAYS_BACK} days'
      AND title IS NOT NULL
      AND "salePrice" > 50
    ORDER BY combo_count DESC
  `);

  const rows = combos.rows || combos;

  // Deduplicate by cache key — this is what matters for the attack list lookup
  const seen = new Map(); // cacheKey → { query, method, count, avgPrice }
  for (const row of rows) {
    const title = (row.title || '').trim();
    if (!title) continue;

    // Extract make/model/year/partType the same way AttackListService does
    const pns = extractPartNumbers(title);
    const price = parseFloat(row.salePrice) || 0;

    // Build the cache key using the SAME function the attack list enrichment uses
    // For PN parts: key = base PN. For keyword parts: key = YEAR|MAKE|MODEL|PARTTYPE
    const sq = buildSearchQuery({ title, year: null, make: null, model: null, partType: null });

    if (!seen.has(sq.cacheKey)) {
      seen.set(sq.cacheKey, {
        query: sq.query,
        method: sq.method,
        cacheKey: sq.cacheKey,
        count: 1,
        totalPrice: price,
        sampleTitle: title,
      });
    } else {
      const entry = seen.get(sq.cacheKey);
      entry.count++;
      entry.totalPrice += price;
    }
  }

  // Sort by frequency (most-sold combos first) and limit
  const uniqueParts = Array.from(seen.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_PARTS);

  console.log('   Found ' + rows.length + ' sales → ' + seen.size + ' unique cache keys');
  console.log('   Refreshing top ' + uniqueParts.length + ' by frequency\n');

  if (uniqueParts.length === 0) {
    console.log('   No parts to refresh. Exiting.');
    await database.destroy();
    return;
  }

  // Step 2: Check which keys are already fresh in cache, skip those
  let alreadyCached = 0;
  const toRefresh = [];
  for (const part of uniqueParts) {
    try {
      const existing = await database('market_demand_cache')
        .where('part_number_base', part.cacheKey)
        .whereRaw("last_updated > NOW() - INTERVAL '24 hours'")
        .first();
      if (existing && parseFloat(existing.ebay_avg_price) > 0) {
        alreadyCached++;
        continue;
      }
    } catch (e) { /* proceed to refresh */ }
    toRefresh.push(part);
  }

  console.log('   Already fresh (< 24h): ' + alreadyCached);
  console.log('   Need refresh: ' + toRefresh.length + '\n');

  // Step 3: Scrape comps for each
  let refreshed = 0, failed = 0, skipped = 0;

  for (let i = 0; i < toRefresh.length; i++) {
    const part = toRefresh[i];

    try {
      const label = (part.sampleTitle || part.query).substring(0, 50);
      process.stdout.write(`\r   [${i + 1}/${toRefresh.length}] ${label}...`);

      const result = await priceCheck.check(part.query, part.totalPrice / part.count || 0);

      if (result.metrics.count === 0) {
        skipped++;
        await new Promise(r => setTimeout(r, DELAY_MS));
        continue;
      }

      // Upsert into market_demand_cache using the EXACT cache key format
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
        part.cacheKey,
        result.metrics.median,
        result.metrics.count,
      ]);

      refreshed++;
    } catch (err) {
      failed++;
      if (failed <= 5) console.error(`\n   ERROR on "${part.cacheKey}": ${err.message}`);
    }

    // Rate limit
    if (i < toRefresh.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  // Step 4: Summary
  const { rows: [stats] } = await database.raw(`
    SELECT COUNT(*) as total, COUNT(CASE WHEN ebay_avg_price > 0 THEN 1 END) as with_price
    FROM market_demand_cache
  `);

  console.log('\n\n═══════════════════════════════════════════');
  console.log('COMPLETE');
  console.log('  Already cached: ' + alreadyCached);
  console.log('  Refreshed:      ' + refreshed);
  console.log('  Skipped:        ' + skipped + ' (no comps found)');
  console.log('  Failed:         ' + failed);
  console.log('  Cache total:    ' + stats.total + ' entries (' + stats.with_price + ' with prices)');
  console.log('═══════════════════════════════════════════');

  await database.destroy();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
