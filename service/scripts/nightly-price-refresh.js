#!/usr/bin/env node
/**
 * DARKHAWK — Nightly Price Refresh
 *
 * Pre-warms market_demand_cache with the EXACT keys that the attack list
 * enrichment reads via MarketPricingService.getCachedPrice().
 *
 * Uses MarketPricingService.scrapeComps() which tries V2 (axios+cheerio)
 * first, then falls back to V1 (Playwright stealth) when rate-limited.
 *
 * Offset tracking: stores last offset in price-refresh-state.json so each
 * run picks up where the last left off. 100 parts/night at ~7s/part ≈ 12 min.
 * Full 1176-key coverage every ~12 days.
 *
 * Schedule: 4 AM daily via run-price-refresh.bat
 * Usage:   node service/scripts/nightly-price-refresh.js [--limit N] [--test] [--reset]
 */

'use strict';

const path = require('path');
const fs = require('fs');
process.chdir(path.resolve(__dirname, '..', '..'));
require('dotenv').config();

const { database } = require('../database/database');
const { buildSearchQuery, scrapeComps, cachePrice } = require('../services/MarketPricingService');
const { extractPartNumbers } = require('../utils/partIntelligence');

const STATE_FILE = path.resolve(__dirname, '..', '..', 'price-refresh-state.json');
const DAYS_BACK = 180;

// Parse CLI args
const args = process.argv.slice(2);
const testMode = args.includes('--test');
const resetMode = args.includes('--reset');
const limitIdx = args.indexOf('--limit');
const MAX_PARTS = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || 100 : (testMode ? 10 : 100);

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch (e) { /* corrupt file, start fresh */ }
  return { offset: 0, lastRun: null, totalKeys: 0 };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function delay() {
  // 5 seconds + random 1-3 second jitter
  const ms = 5000 + Math.floor(Math.random() * 2000 + 1000);
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('DARKHAWK — Nightly Price Refresh');
  console.log(new Date().toISOString());
  if (testMode) console.log('** TEST MODE — limit ' + MAX_PARTS + ' parts **');
  console.log('═══════════════════════════════════════════\n');

  // Load offset state
  let state = loadState();
  if (resetMode) {
    state = { offset: 0, lastRun: null, totalKeys: 0 };
    console.log('   Offset reset to 0\n');
  }

  // Step 1: Get distinct cache keys from YourSale
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

  // Deduplicate by cache key
  const seen = new Map();
  for (const row of rows) {
    const title = (row.title || '').trim();
    if (!title) continue;

    const price = parseFloat(row.salePrice) || 0;
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

  // Sort by frequency (most-sold combos first) — stable order for offset tracking
  const allKeys = Array.from(seen.values())
    .sort((a, b) => b.count - a.count);

  const totalKeys = allKeys.length;

  // Apply offset — wrap around if we've gone past the end
  let offset = state.offset || 0;
  if (offset >= totalKeys) offset = 0;

  const slice = allKeys.slice(offset, offset + MAX_PARTS);
  const nextOffset = (offset + slice.length >= totalKeys) ? 0 : offset + slice.length;

  console.log('   Found ' + rows.length + ' sales → ' + totalKeys + ' unique cache keys');
  console.log('   Offset: ' + offset + ' → ' + nextOffset + ' (processing ' + slice.length + ')');
  if (state.lastRun) console.log('   Last run: ' + state.lastRun);
  console.log();

  if (slice.length === 0) {
    console.log('   No parts to refresh. Exiting.');
    await database.destroy();
    return;
  }

  // Step 2: Check which keys are already fresh, skip those
  let alreadyCached = 0;
  const toRefresh = [];
  for (const part of slice) {
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

  // Step 3: Scrape comps using MarketPricingService.scrapeComps (V2 → V1 fallback)
  let refreshed = 0, failed = 0, skipped = 0;

  for (let i = 0; i < toRefresh.length; i++) {
    const part = toRefresh[i];

    try {
      const label = (part.sampleTitle || part.query).substring(0, 50);
      process.stdout.write(`\r   [${i + 1}/${toRefresh.length}] ${label}...`);

      const result = await scrapeComps(part.query);

      if (!result || result.count === 0) {
        skipped++;
        await delay();
        continue;
      }

      // Cache using MarketPricingService.cachePrice — exact same format
      await cachePrice(part.cacheKey, {}, result);

      refreshed++;
    } catch (err) {
      failed++;
      if (failed <= 5) console.error(`\n   ERROR on "${part.cacheKey}": ${err.message}`);
    }

    // Rate limit: 5s + 1-3s jitter
    if (i < toRefresh.length - 1) {
      await delay();
    }
  }

  // Step 4: Save offset state
  state.offset = nextOffset;
  state.lastRun = new Date().toISOString();
  state.totalKeys = totalKeys;
  state.lastRefreshed = refreshed;
  state.lastSkipped = skipped;
  state.lastFailed = failed;
  saveState(state);

  // Step 5: Summary
  const { rows: [stats] } = await database.raw(`
    SELECT COUNT(*) as total, COUNT(CASE WHEN ebay_avg_price > 0 THEN 1 END) as with_price
    FROM market_demand_cache
  `);

  const coverage = totalKeys > 0 ? Math.round((parseInt(stats.with_price) / totalKeys) * 100) : 0;
  const daysToFull = toRefresh.length > 0 ? Math.ceil(totalKeys / MAX_PARTS) : '∞';

  console.log('\n\n═══════════════════════════════════════════');
  console.log('COMPLETE');
  console.log('  Window:       ' + offset + '-' + (offset + slice.length) + ' of ' + totalKeys);
  console.log('  Already fresh: ' + alreadyCached);
  console.log('  Refreshed:     ' + refreshed);
  console.log('  Skipped:       ' + skipped + ' (no comps found)');
  console.log('  Failed:        ' + failed);
  console.log('  Next offset:   ' + nextOffset);
  console.log('  Cache total:   ' + stats.total + ' entries (' + stats.with_price + ' with prices)');
  console.log('  Coverage:      ' + coverage + '% (' + daysToFull + ' days to full cycle)');
  console.log('═══════════════════════════════════════════');

  await database.destroy();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
