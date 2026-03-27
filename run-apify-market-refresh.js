#!/usr/bin/env node
'use strict';

/**
 * run-apify-market-refresh.js
 *
 * Uses Apify's eBay scraper to pull sold comps for our inventory,
 * then stores results in market_demand_cache using the same key format
 * as MarketPricingService.buildSearchQuery().
 *
 * Usage:
 *   set DATABASE_URL=postgresql://...
 *   set APIFY_TOKEN=apify_api_XXX
 *   node run-apify-market-refresh.js [--source=your_listing] [--limit=5] [--dry-run]
 */

const knex = require('knex');
const axios = require('axios');
const { buildSearchQuery } = require('./service/scripts/smart-query-builder');

// ── CLI flags ──────────────────────────────────────────────────
const args = process.argv.slice(2);
const flags = {};
for (const arg of args) {
  const [key, val] = arg.replace('--', '').split('=');
  flags[key] = val || true;
}

const SOURCE = flags.source || 'your_listing';
const LIMIT = flags.limit ? parseInt(flags.limit) : null;
const DRY_RUN = !!flags['dry-run'];
const APIFY_TOKEN = process.env.APIFY_TOKEN;

if (!APIFY_TOKEN) {
  console.error('ERROR: APIFY_TOKEN environment variable required');
  process.exit(1);
}

// ── DB ─────────────────────────────────────────────────────────
const db = knex({
  client: 'pg',
  connection: { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } },
  pool: { min: 1, max: 3 },
});

// ── PN helpers ─────────────────────────────────────────────────
function stripSuffix(pn) {
  if (!pn) return null;
  pn = pn.trim().toUpperCase();
  const m = pn.match(/^(\d{7,})[A-Z]{2}$/);
  if (m) return m[1];
  return pn;
}

function extractPN(title) {
  if (!title) return null;
  const patterns = [/\b(\d{7,}\w{0,2})\b/, /\b(\d{5}-\d{2}\w{0,3})\b/, /\b([A-Z]{2}\d[A-Z]-\d{4,5}-[A-Z])\b/i];
  for (const p of patterns) { const m = title.match(p); if (m) return m[1]; }
  return null;
}

// ── Apify ──────────────────────────────────────────────────────
const APIFY_BASE = 'https://api.apify.com/v2';

// Actors to try in order — caffein.dev works, tested
const ACTORS = [
  { id: 'caffein.dev~ebay-sold-listings', buildInput: (q) => ({ keyword: q, categoryId: '0', count: 20 }) },
  { id: 'dtrungtin~ebay-items-scraper', buildInput: (q) => ({ searchQuery: q, categoryId: '6030', maxItems: 20, soldItems: true }) },
  { id: 'marielise.dev~ebay-sold-listings-intelligence', buildInput: (q) => ({ keyword: q, maxItems: 20 }) },
];

let workingActor = null;

async function runActorSync(actorId, input) {
  const url = `${APIFY_BASE}/acts/${actorId}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=90`;
  const res = await axios.post(url, input, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 120000,
    validateStatus: (s) => s < 500,
  });
  if (res.status === 404) return null; // actor not found
  if (res.status === 402) { console.error('\n  Apify billing error'); return []; }
  if (res.status >= 400) { console.error(`\n  Apify ${res.status}: ${JSON.stringify(res.data).substring(0, 100)}`); return []; }
  return res.data || [];
}

async function searchSoldComps(query) {
  // If we already found a working actor, use it
  if (workingActor) {
    const items = await runActorSync(workingActor.id, workingActor.buildInput(query));
    return items || [];
  }

  // Try each actor
  for (const actor of ACTORS) {
    try {
      const items = await runActorSync(actor.id, actor.buildInput(query));
      if (items === null) continue; // 404 — actor not found
      if (items.length > 0) {
        workingActor = actor;
        console.log(`\n   [Using actor: ${actor.id}]\n`);
        return items;
      }
      // 0 results but actor responded — might work for other queries
      if (items !== null) {
        workingActor = actor;
        return items;
      }
    } catch (e) {
      console.log(`\n   Actor ${actor.id}: ${e.message.substring(0, 50)}`);
    }
  }
  return [];
}

function parseResults(items) {
  const parsed = [];
  for (const item of items) {
    // caffein.dev uses soldPrice/totalPrice, others use price/currentPrice
    const price = parseFloat(item.soldPrice || item.totalPrice || item.price || item.currentPrice || 0);
    const title = item.title || item.name || item.itemTitle || '';
    if (!title || price <= 0) continue;
    parsed.push({ title, price, soldDate: item.endedAt || item.soldDate || item.endDate || null });
  }
  return parsed;
}

function calcMetrics(items) {
  if (!items.length) return null;
  const prices = items.map(i => i.price).sort((a, b) => a - b);
  const n = prices.length;
  const median = n % 2 === 0 ? (prices[n/2 - 1] + prices[n/2]) / 2 : prices[Math.floor(n/2)];
  return {
    count: n,
    median: Math.round(median * 100) / 100,
    avg: Math.round(prices.reduce((a, b) => a + b, 0) / n * 100) / 100,
    min: prices[0],
    max: prices[n - 1],
  };
}

// ── Main ───────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  DarkHawk — Apify Market Refresh');
  console.log(`  Source: ${SOURCE} | Limit: ${LIMIT || 'all'}`);
  if (DRY_RUN) console.log('  ** DRY RUN **');
  console.log('═══════════════════════════════════════════════════\n');

  // 1. Build query list
  console.log('1. Building query list...');
  let rows = [];

  if (SOURCE === 'your_listing' || SOURCE === 'both') {
    let q = db('YourListing').select('title', 'sku', 'currentPrice')
      .where('listingStatus', 'Active').whereNotNull('title');
    if (LIMIT) q = q.limit(LIMIT);
    const listings = await q;
    console.log(`   [YourListing] ${listings.length} active listings`);
    rows.push(...listings.map(r => ({ title: r.title, pn: r.sku || extractPN(r.title), price: parseFloat(r.currentPrice) || null })));
  }

  if (SOURCE === 'importaparts' || SOURCE === 'both') {
    let q = db('Item').select('title', 'manufacturerPartNumber', 'price')
      .whereNotNull('manufacturerPartNumber').where('seller', 'importapart');
    if (LIMIT) q = q.limit(LIMIT);
    const items = await q;
    console.log(`   [importapart] ${items.length} items`);
    rows.push(...items.map(r => ({ title: r.title, pn: r.manufacturerPartNumber, price: parseFloat(r.price) || null })));
  }

  // Deduplicate
  const qMap = new Map();
  for (const row of rows) {
    const result = buildSearchQuery(row.title);
    if (!result.structured || !result.query || result.query.length < 5) continue;
    const key = result.query.toLowerCase().trim().replace(/\s+/g, ' ');
    if (!qMap.has(key)) {
      qMap.set(key, { query: result.query, parts: result.parts, pn: stripSuffix(row.pn), sampleTitle: row.title });
    }
  }

  const queries = Array.from(qMap.values());
  console.log(`   ${rows.length} rows → ${queries.length} unique queries\n`);

  // 2. Process via Apify
  console.log('2. Running Apify scrapes...\n');
  let refreshed = 0, skipped = 0, failed = 0;

  for (let i = 0; i < queries.length; i++) {
    const entry = queries[i];
    process.stdout.write(`   [${i + 1}/${queries.length}] ${entry.query.substring(0, 50)}...`);

    try {
      const rawItems = await searchSoldComps(entry.query);
      const soldItems = parseResults(rawItems);
      const metrics = calcMetrics(soldItems);

      if (!metrics) {
        skipped++;
        console.log(' no results');
        continue;
      }

      console.log(` ${metrics.count} comps, $${metrics.median} median`);

      // Build cache key
      const { buildSearchQuery: buildMktQ } = require('./service/services/MarketPricingService');
      const sq = buildMktQ({
        title: entry.sampleTitle,
        year: entry.parts.years ? parseInt(entry.parts.years) : null,
        make: entry.parts.make || null,
        model: entry.parts.model || null,
        partType: entry.parts.partType || null,
      });

      // Store top 5 comps as JSON
      const topComps = soldItems.slice(0, 5).map(i => ({ title: i.title?.substring(0, 80), price: i.price }));
      const velocity = metrics.count >= 20 ? 'high' : metrics.count >= 10 ? 'medium' : 'low';
      const salesPerWeek = Math.round((metrics.count / 90) * 7 * 100) / 100;

      if (!DRY_RUN) {
        await db.raw(`
          INSERT INTO market_demand_cache
            (id, part_number_base, ebay_avg_price, ebay_sold_90d,
             source, search_query, ebay_median_price, ebay_min_price, ebay_max_price,
             market_velocity, sales_per_week, top_comps,
             last_updated, "createdAt")
          VALUES (gen_random_uuid(), ?, ?, ?,
                  'apify', ?, ?, ?, ?,
                  ?, ?, ?::jsonb,
                  NOW(), NOW())
          ON CONFLICT (part_number_base)
          DO UPDATE SET
            ebay_avg_price = EXCLUDED.ebay_avg_price,
            ebay_sold_90d = EXCLUDED.ebay_sold_90d,
            source = 'apify',
            search_query = EXCLUDED.search_query,
            ebay_median_price = EXCLUDED.ebay_median_price,
            ebay_min_price = EXCLUDED.ebay_min_price,
            ebay_max_price = EXCLUDED.ebay_max_price,
            market_velocity = EXCLUDED.market_velocity,
            sales_per_week = EXCLUDED.sales_per_week,
            top_comps = EXCLUDED.top_comps,
            last_updated = NOW()
        `, [
          sq.cacheKey, metrics.median, metrics.count,
          entry.query, metrics.median, metrics.min, metrics.max,
          velocity, salesPerWeek, JSON.stringify(topComps),
        ]);
      }
      refreshed++;
    } catch (err) {
      failed++;
      console.log(` ERROR: ${err.message.substring(0, 60)}`);
    }
  }

  // 3. Summary
  let cacheStats = { total: 0, with_price: 0 };
  try {
    const { rows: [s] } = await db.raw('SELECT COUNT(*) as total, COUNT(CASE WHEN ebay_avg_price > 0 THEN 1 END) as with_price FROM market_demand_cache');
    cacheStats = s;
  } catch (e) {}

  console.log('\n═══════════════════════════════════════════════════');
  console.log('COMPLETE');
  console.log(`  Actor:     ${workingActor?.id || 'none found'}`);
  console.log(`  Refreshed: ${refreshed}`);
  console.log(`  Skipped:   ${skipped} (no results)`);
  console.log(`  Failed:    ${failed}`);
  console.log(`  Cache:     ${cacheStats.total} total (${cacheStats.with_price} with prices)`);
  console.log('═══════════════════════════════════════════════════');

  await db.destroy();
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
