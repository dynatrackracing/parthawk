#!/usr/bin/env node
'use strict';

/**
 * run-importapart-drip.js - Market Drip Scraper
 *
 * Fills market_demand_cache with eBay sold comp data for part numbers we care about.
 * 3-bucket priority queue: Active inventory > Sold-not-restocked > Importapart catalog.
 * Comp quality filter: excludes as-is, for-parts, untested comps.
 * Playwright primary, V2 cheerio fallback.
 *
 * Schedule: 6 AM, 1 PM, 9 PM via run-importapart-drip.bat (Task Scheduler)
 * Queue: ~10K PNs, 200/run × 3 runs = 600/day → ~17 day cycle
 *
 * Usage: node run-importapart-drip.js [--limit=200] [--test]
 */

const path = require('path');
const fs = require('fs');
process.chdir(path.resolve(__dirname));
require('dotenv').config();

const knex = require('knex')({
  client: 'pg',
  connection: { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } },
  pool: { min: 1, max: 3 },
});
const { sanitizePartNumberForSearch } = require('./service/utils/partIntelligence');

const STATE_FILE = path.resolve(__dirname, 'importapart-drip-offset.json');
const DELAY_MS = 3000;
const SEVEN_DAYS_MS = 7 * 86400000;

const args = process.argv.slice(2);
const testMode = args.includes('--test');
const limitArg = args.find(a => a.startsWith('--limit='));
const BATCH_SIZE = limitArg ? parseInt(limitArg.split('=')[1]) || 200 : (testMode ? 5 : 200);

// ── Comp quality filter ──────────────────────────────────────
const JUNK_COMP_RE = /\b(AS[\s-]?IS|FOR\s+PARTS|UNTESTED|NOT\s+WORKING|PARTS\s+ONLY|CORE\s+(ONLY|CHARGE|RETURN)|NEEDS\s+PROGRAMMING|MAY\s+NEED|INOP(ERABLE)?|BROKEN|DAMAGED|SALVAGE|JUNK|SCRAP)\b/i;

function filterComps(items) {
  var kept = [];
  var filtered = 0;
  for (var i = 0; i < items.length; i++) {
    if (JUNK_COMP_RE.test(items[i].title || '')) { filtered++; }
    else { kept.push(items[i]); }
  }
  return { kept: kept, filtered: filtered };
}

// ── Playwright scraper ────────────────────────────────────────
var _browser = null;
var _page = null;

async function initBrowser() {
  try {
    var { chromium } = require('playwright-extra');
    var stealth = require('puppeteer-extra-plugin-stealth');
    chromium.use(stealth());
    _browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    var ctx = await _browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    });
    _page = await ctx.newPage();
    return true;
  } catch (e) { return false; }
}

async function closeBrowser() {
  if (_browser) { try { await _browser.close(); } catch (e) {} _browser = null; _page = null; }
}

async function scrapeSoldComps(query) {
  if (!_page) return [];
  var url = 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(query) + '&_sacat=6030&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=60';
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

// ── V2 axios fallback ─────────────────────────────────────────
var priceCheckV2 = null;
try { priceCheckV2 = require('./service/services/PriceCheckServiceV2'); } catch (e) {}

async function scrapeWithFallback(query) {
  if (_page) {
    var items = await scrapeSoldComps(query);
    if (items.length > 0) return items;
  }
  if (priceCheckV2) {
    try {
      var r = await priceCheckV2.check(query, 0);
      if (r && r.metrics && r.metrics.count > 0) {
        return (r.topComps || []).map(function(c) { return { title: c.title, price: c.price }; });
      }
    } catch (e) {}
  }
  return [];
}

// ── Metrics ───────────────────────────────────────────────────
function calcMetrics(items) {
  // Filter out own store sales
  var external = items.filter(function(i) {
    var t = (i.title || '').toLowerCase();
    return t.indexOf('dynatrack') === -1 && t.indexOf('autolumen') === -1;
  });
  // Apply comp quality filter
  var qf = filterComps(external);
  var kept = qf.kept;
  var compFiltered = qf.filtered;

  if (kept.length === 0) return { count: 0, filtered: compFiltered, median: 0, avg: 0, min: 0, max: 0, velocity: 'none', spw: 0, topComps: [] };

  var prices = kept.map(function(i) { return i.price; }).sort(function(a, b) { return a - b; });
  var n = prices.length;
  var median = n % 2 === 0 ? (prices[n / 2 - 1] + prices[n / 2]) / 2 : prices[Math.floor(n / 2)];
  return {
    count: n, filtered: compFiltered,
    median: Math.round(median * 100) / 100,
    avg: Math.round(prices.reduce(function(a, b) { return a + b; }, 0) / n * 100) / 100,
    min: prices[0], max: prices[n - 1],
    velocity: n >= 15 ? 'high' : n >= 8 ? 'medium' : 'low',
    spw: Math.round((n / 90) * 7 * 100) / 100,
    topComps: kept.slice(0, 5).map(function(i) { return { title: (i.title || '').substring(0, 80), price: i.price }; }),
  };
}

// ── State ─────────────────────────────────────────────────────
function loadState() {
  try { if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')); }
  catch (e) {}
  return { lastOffset: 0, lastRun: null, totalInQueue: 0, completedTotal: 0 };
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  DarkHawk - Market Drip Scraper');
  console.log('  ' + new Date().toISOString());
  console.log('  Batch size: ' + BATCH_SIZE + ' | Delay: ' + (DELAY_MS / 1000) + 's');
  console.log('═══════════════════════════════════════════\n');

  // ── Step 1: Build 3-bucket priority queue ──
  console.log('Building queue...');

  // Bucket 1: Active inventory PNs (highest priority)
  var b1 = await knex.raw('SELECT DISTINCT "partNumberBase" as pn FROM "YourListing" WHERE "listingStatus" = \'Active\' AND "partNumberBase" IS NOT NULL AND "partNumberBase" != \'\'');
  var bucket1 = b1.rows.map(function(r) { return r.pn; });

  // Bucket 2: Sold-not-restocked 60d+ PNs
  var b2 = await knex.raw('SELECT DISTINCT ys."partNumberBase" as pn FROM "YourSale" ys WHERE ys."soldDate" >= NOW() - INTERVAL \'365 days\' AND ys."partNumberBase" IS NOT NULL AND ys."partNumberBase" != \'\' AND NOT EXISTS (SELECT 1 FROM "YourListing" yl WHERE yl."partNumberBase" = ys."partNumberBase" AND yl."listingStatus" = \'Active\')');
  var bucket2 = b2.rows.map(function(r) { return r.pn; });

  // Bucket 3: Importapart catalog
  var b3 = await knex.raw('SELECT DISTINCT UPPER("manufacturerPartNumber") as pn FROM "Item" WHERE seller = \'importapart\' AND "manufacturerPartNumber" IS NOT NULL AND "manufacturerPartNumber" != \'\'');
  var bucket3 = b3.rows.map(function(r) { return (r.pn || '').replace(/[\s\-\.]/g, '').toUpperCase(); }).filter(function(pn) { return pn.length >= 5; });

  console.log('  Bucket 1 (active inventory): ' + bucket1.length);
  console.log('  Bucket 2 (sold-not-restocked): ' + bucket2.length);
  console.log('  Bucket 3 (importapart catalog): ' + bucket3.length);

  // Deduplicate: each PN appears once, in highest priority bucket
  var seen = new Set();
  var queue = [];
  function addBucket(pns, priority) {
    for (var i = 0; i < pns.length; i++) {
      var clean = sanitizePartNumberForSearch(pns[i]);
      if (!clean) continue;
      if (seen.has(clean)) continue;
      seen.add(clean);
      queue.push({ pn: clean, raw: pns[i], priority: priority });
    }
  }
  addBucket(bucket1, 1);
  addBucket(bucket2, 2);
  addBucket(bucket3, 3);

  // Sort: priority ASC, then PN ASC (deterministic for offset tracking)
  queue.sort(function(a, b) { return a.priority - b.priority || a.pn.localeCompare(b.pn); });

  console.log('  Total unique (after dedup+sanitize): ' + queue.length);

  // Filter out PNs with fresh cache entries (<7 days)
  var cached = await knex.raw("SELECT part_number_base FROM market_demand_cache WHERE last_updated > NOW() - INTERVAL '7 days' AND ebay_avg_price > 0");
  var freshSet = new Set(cached.rows.map(function(r) { return r.part_number_base; }));
  var fullQueue = queue;
  queue = queue.filter(function(entry) { return !freshSet.has(entry.pn); });
  console.log('  After fresh filter: ' + queue.length + ' (' + (fullQueue.length - queue.length) + ' already fresh)\n');

  // ── Step 2: Apply offset ──
  var state = loadState();
  var offset = state.lastOffset || 0;
  if (offset >= queue.length) { offset = 0; console.log('  Queue wrapped to start\n'); }

  var batch = queue.slice(offset, offset + BATCH_SIZE);
  var nextOffset = (offset + batch.length >= queue.length) ? 0 : offset + batch.length;

  console.log('  Offset: ' + offset + ' → ' + nextOffset + ' (' + batch.length + ' this run)');
  // Show priority breakdown
  var p1 = batch.filter(function(e) { return e.priority === 1; }).length;
  var p2 = batch.filter(function(e) { return e.priority === 2; }).length;
  var p3 = batch.filter(function(e) { return e.priority === 3; }).length;
  console.log('  Bucket mix: P1=' + p1 + ' P2=' + p2 + ' P3=' + p3 + '\n');

  // ── Step 3: Init browser ──
  var browserOk = await initBrowser();
  console.log('  Playwright: ' + (browserOk ? 'OK' : 'unavailable (V2 fallback)') + '\n');

  // ── Step 4: Scrape ──
  var refreshed = 0, noComps = 0, failed = 0, totalFiltered = 0;

  for (var i = 0; i < batch.length; i++) {
    var entry = batch[i];
    process.stdout.write('  [' + (i + 1) + '/' + batch.length + '] P' + entry.priority + ' ' + entry.pn.substring(0, 18).padEnd(18) + ' ');

    try {
      var items = await scrapeWithFallback(entry.raw);
      var metrics = calcMetrics(items);

      if (metrics.count === 0 && metrics.filtered === 0) {
        console.log('no comps');
        noComps++;
      } else {
        var cacheKey = entry.pn; // already sanitized
        await knex.raw(
          'INSERT INTO market_demand_cache' +
          '  (id, part_number_base, key_type, ebay_avg_price, ebay_sold_90d,' +
          '   source, search_query, ebay_median_price, ebay_min_price, ebay_max_price,' +
          '   market_velocity, sales_per_week, top_comps, last_updated, "createdAt")' +
          ' VALUES (gen_random_uuid(), ?, \'pn\', ?, ?, \'market_drip\', ?, ?, ?, ?, ?, ?, ?::jsonb, NOW(), NOW())' +
          ' ON CONFLICT (part_number_base) DO UPDATE SET' +
          '  ebay_avg_price=EXCLUDED.ebay_avg_price, ebay_sold_90d=EXCLUDED.ebay_sold_90d,' +
          '  key_type=\'pn\', source=\'market_drip\', search_query=EXCLUDED.search_query,' +
          '  ebay_median_price=EXCLUDED.ebay_median_price, ebay_min_price=EXCLUDED.ebay_min_price,' +
          '  ebay_max_price=EXCLUDED.ebay_max_price, market_velocity=EXCLUDED.market_velocity,' +
          '  sales_per_week=EXCLUDED.sales_per_week, top_comps=EXCLUDED.top_comps, last_updated=NOW()',
          [cacheKey, metrics.median, metrics.count, entry.raw, metrics.median, metrics.min, metrics.max, metrics.velocity, metrics.spw, JSON.stringify(metrics.topComps)]
        );
        // Snapshot for price history
        try {
          await knex('PriceSnapshot').insert({
            id: knex.raw('gen_random_uuid()'),
            part_number_base: cacheKey,
            soldCount: metrics.count,
            soldPriceAvg: metrics.median,
            soldPriceMedian: metrics.median,
            ebay_median_price: metrics.median,
            ebay_min_price: metrics.min,
            ebay_max_price: metrics.max,
            source: 'market_drip',
            snapshot_date: new Date(),
          });
        } catch (snapErr) { /* snapshot is supplementary */ }

        totalFiltered += metrics.filtered;
        if (metrics.count > 0) {
          console.log(metrics.count + ' kept, ' + metrics.filtered + ' filtered, $' + metrics.median + ' med');
          refreshed++;
        } else {
          console.log('0 kept (' + metrics.filtered + ' all filtered)');
          noComps++;
        }
      }
    } catch (e) {
      console.log('ERROR: ' + e.message.substring(0, 40));
      failed++;
    }

    if (i < batch.length - 1) await new Promise(function(r) { setTimeout(r, DELAY_MS); });
  }

  // ── Step 5: Save state ──
  state.lastOffset = nextOffset;
  state.lastRun = new Date().toISOString();
  state.totalInQueue = queue.length;
  state.completedTotal = (state.completedTotal || 0) + refreshed;
  saveState(state);

  await closeBrowser();

  var stats = await knex.raw("SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE source = 'market_drip')::int as drip, COUNT(*) FILTER (WHERE source = 'importapart_drip')::int as old_drip FROM market_demand_cache");

  console.log('\n═══════════════════════════════════════════');
  console.log('COMPLETE');
  console.log('  Refreshed:   ' + refreshed);
  console.log('  No comps:    ' + noComps);
  console.log('  Failed:      ' + failed);
  console.log('  Comps filtered (as-is/untested): ' + totalFiltered);
  console.log('  Next offset: ' + nextOffset + ' / ' + queue.length);
  console.log('  Cache total: ' + stats.rows[0].total + ' (market_drip=' + stats.rows[0].drip + ', old_drip=' + stats.rows[0].old_drip + ')');
  console.log('  Full cycle:  ~' + Math.ceil(queue.length / 600) + ' days (600/day)');
  console.log('═══════════════════════════════════════════');

  await knex.destroy();
}

main().catch(async function(e) { console.error('Fatal:', e.message); await closeBrowser(); process.exit(1); });
