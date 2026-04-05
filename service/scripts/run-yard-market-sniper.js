#!/usr/bin/env node
'use strict';

/**
 * YARD MARKET SNIPER
 *
 * Prices parts off NEWLY ARRIVED yard vehicles so the attack list is current.
 * NC pull yards only (Raleigh, Durham, Greensboro).
 * Playwright+stealth for eBay scraping (axios/cheerio is blocked).
 *
 * Pipeline:
 *   1. Get vehicles added since last run (default 24h, --hours to override)
 *   2. Filter to NC pull yards only
 *   3. Match to inventory parts via Auto+AIC+Item
 *   4. Extract + sanitize + dedup part numbers
 *   5. Filter to PNs not already in market_demand_cache (<7d)
 *   6. Scrape eBay sold comps via Playwright stealth
 *   7. Store in market_demand_cache + PriceSnapshot
 *
 * Flags:
 *   --dry-run   DEFAULT. Preview only, no scraping or writing.
 *   --execute   Actually scrape and write.
 *   --limit=N   Cap PNs per run. Default 50.
 *   --hours=N   Lookback window. Default 24.
 *
 * Usage:
 *   node service/scripts/run-yard-market-sniper.js --dry-run
 *   node service/scripts/run-yard-market-sniper.js --execute --limit=50
 *   node service/scripts/run-yard-market-sniper.js --execute --hours=48
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
const { shouldExclude } = require('../services/OpportunityService');

// CLI flags
const EXECUTE = process.argv.includes('--execute');
const DRY_RUN = !EXECUTE;
const LIMIT = parseInt((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || '50', 10);
const HOURS = parseInt((process.argv.find(a => a.startsWith('--hours=')) || '').split('=')[1] || '24', 10);

// NC pull yards — the yards we actually drive to
const PULL_YARD_NAMES = ['LKQ Raleigh', 'LKQ Durham', 'LKQ Greensboro'];

// Comp quality filter (same as market drip)
const JUNK_COMP_RE = /\b(AS[\s-]?IS|FOR\s+PARTS|UNTESTED|NOT\s+WORKING|PARTS\s+ONLY|CORE\s+(ONLY|CHARGE|RETURN)|NEEDS\s+PROGRAMMING|MAY\s+NEED|INOP(ERABLE)?|BROKEN|DAMAGED|SALVAGE|JUNK|SCRAP)\b/i;

function filterComps(items) {
  const kept = [], filtered = [];
  for (const item of items) {
    if (JUNK_COMP_RE.test(item.title || '')) filtered.push(item);
    else kept.push(item);
  }
  return { kept, filteredCount: filtered.length };
}

// PN normalization: strip revision suffix for cache key
function stripSuffix(pn) {
  if (!pn) return pn;
  const chrysler = pn.match(/^(\d{7,})[A-Z]{2}$/i);
  if (chrysler) return chrysler[1];
  const ford = pn.match(/^(.+)-([A-Z]{2})$/i);
  if (ford && ford[1].includes('-')) return ford[1];
  return pn;
}

// ── Playwright stealth ──────────────────────────────────────
let _browser = null;
let _page = null;

async function initBrowser() {
  try {
    const { chromium } = require('playwright-extra');
    const stealth = require('puppeteer-extra-plugin-stealth');
    chromium.use(stealth());
    _browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const ctx = await _browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    });
    _page = await ctx.newPage();
    return true;
  } catch (e) {
    console.error('  Playwright init failed:', e.message);
    return false;
  }
}

async function closeBrowser() {
  if (_browser) { try { await _browser.close(); } catch (e) {} _browser = null; _page = null; }
}

async function scrapeSoldComps(query) {
  if (!_page) return [];
  const url = 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(query) + '&_sacat=6030&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=60';
  try {
    await _page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await _page.waitForTimeout(2500);
    await _page.evaluate(function() { window.scrollTo(0, document.body.scrollHeight); });
    await _page.waitForTimeout(1000);

    return await _page.evaluate(function() {
      var results = [];
      var seen = {};
      document.querySelectorAll('ul.srp-results > li').forEach(function(el) {
        try {
          var innerText = el.innerText || '';
          if (innerText.includes('Shop on eBay') || innerText.includes('Results matching fewer words')) return;
          var title = '';
          var ct = el.querySelector('.s-card__title');
          var it = el.querySelector('.s-item__title');
          title = (ct ? ct.textContent : it ? it.textContent : '').trim().replace(/Opens in a new window or tab$/i, '').trim();
          if (!title) return;
          var cp = el.querySelector('.s-card__price');
          var ip = el.querySelector('.s-item__price');
          var pt = (cp ? cp.textContent : ip ? ip.textContent : '').trim();
          var pm = pt.match(/\$([\d,]+\.?\d*)/);
          if (!pm) return;
          var price = parseFloat(pm[1].replace(',', ''));
          if (isNaN(price) || price <= 0) return;
          var key = title.substring(0, 50) + price;
          if (seen[key]) return;
          seen[key] = true;
          results.push({ title: title, price: price });
        } catch (e) {}
      });
      return results;
    });
  } catch (e) { return []; }
}

function calcMetrics(items) {
  // Filter own store sales
  const external = items.filter(i => {
    const t = (i.title || '').toLowerCase();
    return !t.includes('dynatrack') && !t.includes('autolumen');
  });
  // Filter junk comps
  const { kept, filteredCount } = filterComps(external);
  if (kept.length === 0) return { count: 0, filteredCount };

  const prices = kept.map(i => i.price).sort((a, b) => a - b);
  const n = prices.length;
  const median = n % 2 === 0 ? (prices[n / 2 - 1] + prices[n / 2]) / 2 : prices[Math.floor(n / 2)];
  return {
    count: n,
    filteredCount,
    median: Math.round(median * 100) / 100,
    avg: Math.round(prices.reduce((a, b) => a + b, 0) / n * 100) / 100,
    min: prices[0],
    max: prices[n - 1],
    salesPerWeek: Math.round((n / 90) * 7 * 100) / 100,
  };
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  const cutoff = new Date(Date.now() - HOURS * 60 * 60 * 1000);
  const cutoffStr = cutoff.toISOString().replace('T', ' ').substring(0, 19);

  console.log('═══════════════════════════════════════════════════');
  console.log('  YARD MARKET SNIPER');
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : '🔴 EXECUTE'} | Limit: ${LIMIT} | Lookback: ${HOURS}h`);
  console.log(`  Since: ${cutoffStr}`);
  console.log(`  Pull yards: ${PULL_YARD_NAMES.join(', ')}`);
  console.log('═══════════════════════════════════════════════════\n');

  // 1. Get pull yard IDs
  const yards = await knex('yard').whereIn('name', PULL_YARD_NAMES).select('id', 'name');
  if (yards.length === 0) {
    console.log('ERROR: No pull yards found in DB. Looking for:', PULL_YARD_NAMES.join(', '));
    await knex.destroy();
    return;
  }
  const yardIds = yards.map(y => y.id);
  console.log(`1. Pull yards: ${yards.map(y => y.name).join(', ')}\n`);

  // 2. Get new vehicles in pull yards since cutoff
  const allNew = await knex('yard_vehicle')
    .where('active', true)
    .where('first_seen', '>=', cutoff)
    .select('year', 'make', 'model', 'yard_id');

  const pullNew = allNew.filter(v => yardIds.includes(v.yard_id));

  console.log(`2. New vehicles since ${cutoffStr}:`);
  console.log(`   ${allNew.length} total across all yards → ${pullNew.length} in pull yards\n`);

  if (pullNew.length === 0) {
    console.log(`   No new vehicles in pull yards since ${cutoffStr}. Nothing to snipe.`);
    await knex.destroy();
    return;
  }

  // 3. Get unique year|make|model combos
  const ymmSet = new Set();
  for (const v of pullNew) {
    if (v.year && v.make && v.model) {
      ymmSet.add(`${v.year}|${v.make.toUpperCase()}|${v.model.toUpperCase()}`);
    }
  }
  console.log(`   ${ymmSet.size} unique year/make/model combos\n`);

  // 4. Match to inventory parts via Auto+AIC+Item
  console.log('3. Matching to inventory parts (batch query)...');
  const matchedPNs = new Map();

  let items;
  if (ymmSet.size > 0) {
    // Use the same approach as the old sniper — EXISTS subquery against yard_vehicle
    items = await knex.raw(`
      SELECT DISTINCT ON (i.id) i.title, i.price, i."partNumberBase", i."manufacturerPartNumber"
      FROM "Auto" a
      JOIN "AutoItemCompatibility" aic ON a.id = aic."autoId"
      JOIN "Item" i ON i.id = aic."itemId"
      WHERE i.price > 0
      AND EXISTS (
        SELECT 1 FROM yard_vehicle yv
        WHERE yv.active = true
        AND yv.first_seen >= ?
        AND yv.yard_id = ANY(?)
        AND CAST(yv.year AS INTEGER) = a.year
        AND UPPER(yv.make) = UPPER(a.make)
        AND UPPER(yv.model) = UPPER(a.model)
      )
    `, [cutoff, yardIds]);
  } else {
    items = { rows: [] };
  }

  let skippedExcluded = 0;
  for (const item of items.rows) {
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

  console.log(`   ${items.rows.length} inventory items → ${skippedExcluded} excluded → ${matchedPNs.size} unique PNs\n`);

  // 5. Sanitize, deduplicate, filter cache
  console.log('4. Sanitizing and filtering...');

  const rawQueue = [];
  for (const [base, data] of matchedPNs) {
    if (data.price < 50) continue;
    rawQueue.push({ base, raw: data.raw, price: data.price, sampleTitle: data.titles[0] || base });
  }

  const cleanQueue = deduplicatePNQueue(rawQueue);
  console.log(`   ${rawQueue.length} raw PNs → ${cleanQueue.length} after sanitize+dedup`);

  const staleCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const freshCache = await knex('market_demand_cache')
    .where('last_updated', '>=', staleCutoff)
    .select('part_number_base');
  const freshSet = new Set(freshCache.map(r => r.part_number_base));

  const toScrape = cleanQueue.filter(entry => !freshSet.has(entry.base));
  toScrape.sort((a, b) => b.price - a.price);

  const queue = toScrape.slice(0, LIMIT);

  console.log(`   ${toScrape.length} need scraping → ${queue.length} this run (limit=${LIMIT})\n`);

  // 6. Queue preview
  console.log('5. Queue:');
  queue.slice(0, 15).forEach((entry, i) => {
    console.log(`   ${String(i + 1).padStart(3)}. ${entry.base.padEnd(18)} $${String(Math.round(entry.price)).padStart(4)} | ${entry.sampleTitle}`);
  });
  if (queue.length > 15) console.log(`   ... and ${queue.length - 15} more`);
  console.log('');

  if (DRY_RUN) {
    console.log('═══════════════════════════════════════════════════');
    console.log('  DRY RUN COMPLETE — no scraping or writing done');
    console.log(`  Would scrape ${queue.length} part numbers`);
    console.log('  Run with --execute to actually scrape');
    console.log('═══════════════════════════════════════════════════\n');
    await knex.destroy();
    return;
  }

  // 7. Init Playwright
  console.log('6. Initializing Playwright...');
  const browserOk = await initBrowser();
  if (!browserOk) {
    console.log('   FATAL: Playwright unavailable. Cannot scrape.');
    await knex.destroy();
    return;
  }
  console.log('   Playwright: OK\n');

  // 8. Scrape and cache
  console.log('7. Scraping eBay sold comps...\n');
  let scraped = 0, cached = 0, noResults = 0, errors = 0;

  for (let i = 0; i < queue.length; i++) {
    const entry = queue[i];
    process.stdout.write(`   [${i + 1}/${queue.length}] ${entry.base.padEnd(18)}`);

    try {
      const query = `"${entry.raw}"`;
      let items = await scrapeSoldComps(query);

      // Retry once if 0 results
      if (items.length === 0) {
        await new Promise(r => setTimeout(r, 3000));
        items = await scrapeSoldComps(query);
      }

      const metrics = calcMetrics(items);

      if (!metrics || metrics.count === 0) {
        noResults++;
        console.log('no comps');
      } else {
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
        `, [entry.base, metrics.median, metrics.count, metrics.median, metrics.min, metrics.max, metrics.salesPerWeek]);

        try {
          await knex('PriceSnapshot').insert({
            id: knex.raw('gen_random_uuid()'),
            part_number_base: entry.base,
            soldCount: metrics.count,
            soldPriceAvg: metrics.avg,
            soldPriceMedian: metrics.median,
            ebay_median_price: metrics.median,
            ebay_min_price: metrics.min,
            ebay_max_price: metrics.max,
            source: 'yard_sniper',
            snapshot_date: new Date(),
          });
        } catch (snapErr) { /* snapshot is supplementary */ }

        cached++;
        console.log(`${metrics.count} kept, ${metrics.filteredCount} filtered, $${metrics.median} med`);
      }
      scraped++;
    } catch (err) {
      errors++;
      console.log(`ERROR: ${err.message.substring(0, 50)}`);
    }

    // 2-3s delay between scrapes
    if (i < queue.length - 1) await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
  }

  await closeBrowser();

  // 9. Summary
  const cacheTotal = await knex('market_demand_cache').count('* as count').first();

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  SNIPER COMPLETE');
  console.log(`  Scraped:    ${scraped}`);
  console.log(`  Cached:     ${cached}`);
  console.log(`  No results: ${noResults}`);
  console.log(`  Errors:     ${errors}`);
  console.log(`  Cache total: ${cacheTotal.count}`);
  console.log('═══════════════════════════════════════════════════\n');

  await knex.destroy();
}

main().catch(async err => {
  console.error('FATAL:', err.message);
  await closeBrowser();
  process.exit(1);
});
