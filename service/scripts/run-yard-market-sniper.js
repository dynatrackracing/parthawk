#!/usr/bin/env node
'use strict';

/**
 * YARD MARKET SNIPER
 *
 * Fills market_demand_cache for parts matched to new yard vehicles.
 * Searches by PART NUMBER ONLY — no keyword fallback.
 * Uses PriceCheckServiceV2 (cheerio) to scrape eBay sold listings.
 *
 * Pipeline:
 *   1. Get active yard vehicles (last 7 days of last_seen)
 *   2. Match each to inventory parts via Auto+AIC+Item
 *   3. Extract part numbers from matched Item titles
 *   4. Filter to PNs not already in market_demand_cache (or stale >7d)
 *   5. Scrape eBay sold comps for each PN (quoted exact match)
 *   6. Store results in market_demand_cache
 *
 * Flags:
 *   --dry-run   DEFAULT. Preview only, no scraping or writing.
 *   --execute   Actually scrape and write.
 *   --limit=N   Cap PNs per run. Default 50.
 *
 * Usage:
 *   node service/scripts/run-yard-market-sniper.js --dry-run
 *   node service/scripts/run-yard-market-sniper.js --execute --limit=50
 */

const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '../../.env') }); } catch (e) {}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }

const knex = require('knex')({
  client: 'pg',
  connection: { connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } },
  pool: { min: 1, max: 3 },
});

const { extractPartNumbers, sanitizePartNumberForSearch, deduplicatePNQueue } = require('../utils/partIntelligence');
// Reuse the same exclude filter from OpportunityService — single source of truth
// This skips complete engines, complete transmissions, and body panels
// Everything else (modules, sensors, pumps, etc.) passes through
const { shouldExclude } = require('../services/OpportunityService');

// CLI flags
const EXECUTE = process.argv.includes('--execute');
const DRY_RUN = !EXECUTE;
const LIMIT = parseInt((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || '50', 10);

// PN normalization: strip revision suffix for cache key
function stripSuffix(pn) {
  if (!pn) return pn;
  // Chrysler/Mopar: 56044691AA → 56044691
  const chrysler = pn.match(/^(\d{7,})[A-Z]{2}$/i);
  if (chrysler) return chrysler[1];
  // Ford: CT43-2C405-AB → CT43-2C405
  const ford = pn.match(/^(.+)-([A-Z]{2})$/i);
  if (ford && ford[1].includes('-')) return ford[1];
  return pn;
}

async function scrapePN(pn) {
  // Use PriceCheckServiceV2 scrapeSoldComps directly with quoted PN
  const { scrapeSoldComps, calculateMetrics } = require('../services/PriceCheckServiceV2');
  // Quoted exact match
  const query = `"${pn}"`;
  let items = await scrapeSoldComps(query);

  // Retry once if 0 results (eBay throttle)
  if (items.length === 0) {
    await new Promise(r => setTimeout(r, 3000));
    items = await scrapeSoldComps(query);
  }

  if (items.length === 0) return null;

  const metrics = calculateMetrics(items, 0);
  return {
    count: metrics.count,
    avg: metrics.avg,
    median: metrics.median,
    min: metrics.min,
    max: metrics.max,
    salesPerWeek: metrics.salesPerWeek,
  };
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  YARD MARKET SNIPER');
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : '🔴 EXECUTE'} | Limit: ${LIMIT}`);
  console.log('═══════════════════════════════════════════════════\n');

  // 1. Get recent yard vehicles (last_seen within 7 days)
  console.log('1. Finding recent yard vehicles...');
  const vehicles = await knex('yard_vehicle')
    .where('active', true)
    .where('last_seen', '>=', knex.raw("NOW() - INTERVAL '7 days'"))
    .select('year', 'make', 'model');

  console.log(`   ${vehicles.length} active vehicles (last 7 days)\n`);

  // 2. Get unique year|make|model combos
  const ymmSet = new Set();
  for (const v of vehicles) {
    if (v.year && v.make && v.model) {
      ymmSet.add(`${v.year}|${v.make.toUpperCase()}|${v.model.toUpperCase()}`);
    }
  }
  console.log(`   ${ymmSet.size} unique year/make/model combos\n`);

  // 3. Match to inventory parts via single batch query (Auto+AIC+Item)
  console.log('2. Matching to inventory parts (batch query)...');
  const matchedPNs = new Map(); // base PN → { raw, titles[], price }

  // Build a single query that joins yard vehicles to inventory
  const items = await knex.raw(`
    SELECT DISTINCT ON (i.id) i.title, i.price, i."partNumberBase", i."manufacturerPartNumber"
    FROM "Auto" a
    JOIN "AutoItemCompatibility" aic ON a.id = aic."autoId"
    JOIN "Item" i ON i.id = aic."itemId"
    WHERE i.price > 0
    AND EXISTS (
      SELECT 1 FROM yard_vehicle yv
      WHERE yv.active = true
      AND yv.last_seen >= NOW() - INTERVAL '7 days'
      AND CAST(yv.year AS INTEGER) = a.year
      AND UPPER(yv.make) = UPPER(a.make)
      AND UPPER(yv.model) = UPPER(a.model)
    )
  `);

  let skippedExcluded = 0;
  for (const item of items.rows) {
    // Same filter as OpportunityService — skip engines, transmissions, body panels
    if (shouldExclude(item.title)) { skippedExcluded++; continue; }

    const pns = extractPartNumbers(item.title || '');
    if (item.partNumberBase && !pns.find(p => p.base === item.partNumberBase)) {
      pns.push({ raw: item.partNumberBase, normalized: item.partNumberBase, base: item.partNumberBase });
    }

    for (const pn of pns) {
      if (!pn.base || pn.base.length < 5) continue;
      if (!matchedPNs.has(pn.base)) {
        matchedPNs.set(pn.base, { raw: pn.raw, price: parseFloat(item.price) || 0, titles: [] });
      }
      const entry = matchedPNs.get(pn.base);
      if (entry.titles.length < 3) entry.titles.push((item.title || '').substring(0, 60));
    }
  }

  console.log(`   ${items.rows.length} inventory items → ${skippedExcluded} excluded (engines/trans/panels) → ${matchedPNs.size} unique part numbers\n`);

  // 4. Sanitize and deduplicate PNs, then filter against cache
  console.log('3. Sanitizing and deduplicating PNs...');

  // Build raw queue from matchedPNs
  const rawQueue = [];
  for (const [base, data] of matchedPNs) {
    if (data.price < 50) continue;
    rawQueue.push({ base, raw: data.raw, price: data.price, sampleTitle: data.titles[0] || base });
  }

  // Sanitize + deduplicate (strips junk, Ford ECU suffixes, dash variants)
  const cleanQueue = deduplicatePNQueue(rawQueue);
  const junkRemoved = rawQueue.length - cleanQueue.length;
  console.log(`   ${rawQueue.length} raw PNs → ${cleanQueue.length} after sanitize+dedup (${junkRemoved} junk/dupes removed)`);

  // Check against cache
  const staleCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const freshCache = await knex('market_demand_cache')
    .where('last_updated', '>=', staleCutoff)
    .select('part_number_base');
  const freshSet = new Set(freshCache.map(r => r.part_number_base));

  const toScrape = cleanQueue.filter(entry => !freshSet.has(entry.base));

  // Sort by price descending (highest value first)
  toScrape.sort((a, b) => b.price - a.price);

  // Apply limit
  const queue = toScrape.slice(0, LIMIT);

  console.log(`   ${toScrape.length} PNs need scraping (${toScrape.length - queue.length} beyond limit)`);
  console.log(`   Queue: ${queue.length} PNs (limit=${LIMIT})\n`);

  // 5. Show queue preview
  console.log('4. Queue preview (top entries):');
  queue.slice(0, 15).forEach((entry, i) => {
    console.log(`   ${String(i + 1).padStart(3)}. ${entry.base.padEnd(18)} $${String(Math.round(entry.price)).padStart(4)} | ${entry.sampleTitle}`);
  });
  if (queue.length > 15) console.log(`   ... and ${queue.length - 15} more`);
  console.log('');

  if (DRY_RUN) {
    console.log('═══════════════════════════════════════════════════');
    console.log('  DRY RUN COMPLETE — no scraping or writing done');
    console.log(`  Would scrape ${queue.length} part numbers`);
    console.log(`  Run with --execute to actually scrape`);
    console.log('═══════════════════════════════════════════════════\n');
    await knex.destroy();
    return;
  }

  // 6. Scrape and cache
  console.log('5. Scraping eBay sold comps...\n');
  let scraped = 0, cached = 0, noResults = 0, errors = 0;

  for (let i = 0; i < queue.length; i++) {
    const entry = queue[i];
    process.stdout.write(`   [${i + 1}/${queue.length}] ${entry.base.padEnd(18)}`);

    try {
      const result = await scrapePN(entry.raw);

      if (!result || result.count === 0) {
        noResults++;
        console.log('  0 results');
      } else {
        // Write to cache
        await knex.raw(`
          INSERT INTO market_demand_cache
            (id, part_number_base, key_type, ebay_avg_price, ebay_sold_90d,
             ebay_median_price, ebay_min_price, ebay_max_price, sales_per_week,
             source, last_updated, "createdAt")
          VALUES (gen_random_uuid(), ?, 'pn', ?, ?, ?, ?, ?, ?, 'yard_sniper', NOW(), NOW())
          ON CONFLICT (part_number_base) DO UPDATE SET
            key_type = 'pn',
            ebay_avg_price = EXCLUDED.ebay_avg_price,
            ebay_sold_90d = EXCLUDED.ebay_sold_90d,
            ebay_median_price = EXCLUDED.ebay_median_price,
            ebay_min_price = EXCLUDED.ebay_min_price,
            ebay_max_price = EXCLUDED.ebay_max_price,
            sales_per_week = EXCLUDED.sales_per_week,
            source = 'yard_sniper',
            last_updated = NOW()
        `, [entry.base, result.median, result.count, result.median, result.min, result.max, result.salesPerWeek]);

        // Snapshot for price history
        try {
          await knex('PriceSnapshot').insert({
            id: knex.raw('gen_random_uuid()'),
            part_number_base: entry.base,
            soldCount: result.count,
            soldPriceAvg: result.avg,
            soldPriceMedian: result.median,
            ebay_median_price: result.median,
            ebay_min_price: result.min,
            ebay_max_price: result.max,
            source: 'yard_sniper',
            snapshot_date: new Date(),
          });
        } catch (snapErr) { /* snapshot is supplementary */ }

        cached++;
        console.log(`  ${result.count} sold, $${result.median} med`);
      }
      scraped++;
    } catch (err) {
      errors++;
      console.log(`  ERROR: ${err.message.substring(0, 50)}`);
    }

    // Rate limit: 2-3s between scrapes
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
  }

  // 7. Summary
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  SNIPER COMPLETE');
  console.log(`  Scraped:    ${scraped}`);
  console.log(`  Cached:     ${cached}`);
  console.log(`  No results: ${noResults}`);
  console.log(`  Errors:     ${errors}`);

  const cacheTotal = await knex('market_demand_cache').count('* as count').first();
  console.log(`  Cache total: ${cacheTotal.count}`);
  console.log('═══════════════════════════════════════════════════\n');

  await knex.destroy();
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
