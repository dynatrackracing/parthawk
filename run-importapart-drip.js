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
const { buildSearchQuery, filterRelevantItems } = require('./service/scripts/smart-query-builder');

const STATE_FILE = path.resolve(__dirname, 'importapart-drip-offset.json');

// ── Exclusion filter (mirrors AttackListService.isExcludedPart) ──
function isExcludedPart(title) {
  var t = (title || '').toUpperCase();
  if (/\b(ENGINE|MOTOR) ASSEMBLY\b/.test(t)) return true;
  if (/\b(LONG|SHORT) BLOCK\b/.test(t)) return true;
  if (/\b(COMPLETE|CRATE|REMAN) ENGINE\b/.test(t)) return true;
  if (/\bENGINE BLOCK\b/.test(t)) return true;
  if (/\bCYLINDER HEAD\b/.test(t)) return true;
  if (/\b(PISTON|CRANKSHAFT|CONNECTING ROD|HEAD GASKET)\b/.test(t)) return true;
  if (/\b(OIL PAN|TIMING CHAIN|TIMING BELT|ROCKER ARM|LIFTER|PUSHROD)\b/.test(t)) return true;
  if (/\b(OIL PUMP|FLYWHEEL|FLEXPLATE)\b/.test(t)) return true;
  if (/\b(TRANSMISSION|TRANSAXLE) ASSEMBLY\b/.test(t)) return true;
  if (/\b(COMPLETE|REMAN) TRANSMISSION\b/.test(t)) return true;
  if (/\bFENDER\b/.test(t)) return true;
  if (/\bBUMPER (COVER|ASSEMBLY)\b/.test(t)) return true;
  if (/\bHOOD PANEL\b/.test(t)) return true;
  if (/\bDOOR SHELL\b/.test(t)) return true;
  if (/\b(QUARTER|ROCKER) PANEL\b/.test(t)) return true;
  if (/\b(BED SIDE|TRUCK BED|TRUNK LID|ROOF PANEL)\b/.test(t)) return true;
  if (/\b(AIRBAG|AIR\s*BAG)\b/.test(t)) return true;
  if (/\bSRS\s*(MODULE|SENSOR|UNIT)\b/.test(t)) return true;
  if (/\bSUPPLEMENTAL\s*RESTRAINT\b/.test(t)) return true;
  return false;
}

// Price tier: returns 1-10 (1 = highest priority)
function priceTier(price, hasPN) {
  var base;
  if (price >= 500) base = 0;
  else if (price >= 350) base = 2;
  else if (price >= 250) base = 4;
  else if (price >= 150) base = 6;
  else base = 8; // $100-149
  return base + (hasPN ? 1 : 2); // PN-first within each price tier
}
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

  // ── Step 1: Build tiered priority queue ──
  console.log('Building queue...');

  // Bucket 1: Active inventory (with titles for exclusion + price lookup)
  var b1 = await knex.raw('SELECT DISTINCT ON ("partNumberBase") "partNumberBase" as pn, title, COALESCE("currentPrice"::numeric, 0) as price FROM "YourListing" WHERE "listingStatus" = \'Active\' AND title IS NOT NULL ORDER BY "partNumberBase", "currentPrice" DESC NULLS LAST');
  var bucket1 = b1.rows;

  // Bucket 2: Sold-not-restocked (with titles + sale prices)
  var b2 = await knex.raw('SELECT DISTINCT ON (ys."partNumberBase") ys."partNumberBase" as pn, ys.title, ys."salePrice"::numeric as price FROM "YourSale" ys WHERE ys."soldDate" >= NOW() - INTERVAL \'365 days\' AND ys."partNumberBase" IS NOT NULL AND ys."partNumberBase" != \'\' AND NOT EXISTS (SELECT 1 FROM "YourListing" yl WHERE yl."partNumberBase" = ys."partNumberBase" AND yl."listingStatus" = \'Active\') ORDER BY ys."partNumberBase", ys."salePrice"::numeric DESC NULLS LAST');
  var bucket2 = b2.rows;

  // Bucket 3: Importapart catalog (with titles + prices)
  var b3 = await knex.raw('SELECT DISTINCT ON (UPPER("manufacturerPartNumber")) UPPER("manufacturerPartNumber") as pn, title, COALESCE(price::numeric, 0) as price FROM "Item" WHERE seller = \'importapart\' AND "manufacturerPartNumber" IS NOT NULL AND "manufacturerPartNumber" != \'\' ORDER BY UPPER("manufacturerPartNumber"), price DESC NULLS LAST');
  var bucket3 = b3.rows.map(function(r) { return { pn: (r.pn || '').replace(/[\s\-\.]/g, '').toUpperCase(), title: r.title, price: r.price }; }).filter(function(r) { return r.pn.length >= 5; });

  // Existing cache prices for fallback
  var cacheRows = await knex.raw("SELECT part_number_base, ebay_avg_price, last_updated FROM market_demand_cache");
  var cacheMap = {};
  for (var ci = 0; ci < cacheRows.rows.length; ci++) {
    var cr = cacheRows.rows[ci];
    cacheMap[cr.part_number_base] = { price: parseFloat(cr.ebay_avg_price) || 0, lastUpdated: cr.last_updated };
  }

  console.log('  Bucket 1 (active inventory): ' + bucket1.length);
  console.log('  Bucket 2 (sold-not-restocked): ' + bucket2.length);
  console.log('  Bucket 3 (importapart catalog): ' + bucket3.length);

  // Deduplicate + filter: exclusion, price floor, tier assignment
  var seen = new Set();
  var queue = [];
  var excludedCount = 0, priceFloorCount = 0, noPnKeywordCount = 0;

  function addEntry(raw) {
    var title = raw.title || '';
    if (isExcludedPart(title)) { excludedCount++; return; }

    var hasPN = !!(raw.pn && raw.pn.trim());
    var clean = hasPN ? sanitizePartNumberForSearch(raw.pn) : null;
    var key = clean || ('kw:' + title.substring(0, 60).toLowerCase());
    if (seen.has(key)) return;

    // Best known price: listing/sale price → cache price → 0
    var bestPrice = parseFloat(raw.price) || 0;
    if (bestPrice <= 0 && clean && cacheMap[clean]) bestPrice = cacheMap[clean].price;
    if (bestPrice < 100) { priceFloorCount++; return; }

    // For keyword entries: must have make + model
    if (!clean) {
      var sq = buildSearchQuery(title);
      if (!sq.parts || !sq.parts.make || !sq.parts.model) return; // skip: can't build keyword query
      noPnKeywordCount++;
    }

    seen.add(key);
    var tier = priceTier(bestPrice, !!clean);
    // Check freshness
    var isFresh = clean && cacheMap[clean] && cacheMap[clean].lastUpdated && (Date.now() - new Date(cacheMap[clean].lastUpdated).getTime() < SEVEN_DAYS_MS);
    if (isFresh) return;

    queue.push({ pn: clean, raw: raw.pn || '', title: title, tier: tier, price: bestPrice, hasPN: !!clean });
  }

  for (var i1 = 0; i1 < bucket1.length; i1++) addEntry(bucket1[i1]);
  for (var i2 = 0; i2 < bucket2.length; i2++) addEntry(bucket2[i2]);
  for (var i3 = 0; i3 < bucket3.length; i3++) addEntry(bucket3[i3]);

  // Sort: tier ASC (price descending, PN first), then price DESC within tier
  queue.sort(function(a, b) { return a.tier - b.tier || b.price - a.price; });

  var pnEntries = queue.filter(function(e) { return e.hasPN; }).length;
  var kwEntries = queue.filter(function(e) { return !e.hasPN; }).length;
  console.log('  Excluded (engines/trans/panels/airbags): ' + excludedCount);
  console.log('  Below $100 floor: ' + priceFloorCount);
  console.log('  Total queue: ' + queue.length + ' (' + pnEntries + ' by PN, ' + kwEntries + ' by keyword)');
  // Tier breakdown
  for (var t = 1; t <= 10; t++) {
    var tc = queue.filter(function(e) { return e.tier === t; }).length;
    if (tc > 0) console.log('    Tier ' + t + ': ' + tc);
  }
  console.log('');

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
  var refreshed = 0, noComps = 0, failed = 0, totalFiltered = 0, kwSearches = 0, kwHits = 0;

  for (var i = 0; i < batch.length; i++) {
    var entry = batch[i];
    var label = entry.hasPN ? entry.pn.substring(0, 18).padEnd(18) : ('KW:' + entry.title.substring(0, 15)).padEnd(18);
    process.stdout.write('  [' + (i + 1) + '/' + batch.length + '] T' + entry.tier + ' ' + label + ' ');

    try {
      var searchQuery, cacheKey, keyType;

      if (entry.hasPN) {
        // PN search path
        searchQuery = entry.raw;
        cacheKey = entry.pn;
        keyType = 'pn';
      } else {
        // Keyword search path
        var sq = buildSearchQuery(entry.title);
        if (!sq.parts || !sq.parts.make || !sq.parts.model) {
          console.log('skip (no make+model)');
          noComps++;
          continue;
        }
        searchQuery = sq.query;
        cacheKey = [sq.parts.partType || '', sq.parts.make, sq.parts.model, sq.parts.years || ''].filter(Boolean).join('|').substring(0, 100);
        keyType = 'keyword';
        kwSearches++;
      }

      var items = await scrapeWithFallback(searchQuery);
      var metrics;

      if (!entry.hasPN && items.length > 0) {
        // Keyword path: apply relevance filter
        var relevance = filterRelevantItems(buildSearchQuery(entry.title).parts, items);
        if (relevance.relevant < 3) {
          console.log('kw: ' + relevance.relevant + '/' + items.length + ' relevant (need 3)');
          noComps++;
          if (i < batch.length - 1) await new Promise(function(r) { setTimeout(r, DELAY_MS); });
          continue;
        }
        kwHits++;
        metrics = calcMetrics(relevance.items);
      } else {
        metrics = calcMetrics(items);
      }

      if (metrics.count === 0 && metrics.filtered === 0) {
        console.log('no comps');
        noComps++;
      } else {
        await knex.raw(
          'INSERT INTO market_demand_cache' +
          '  (id, part_number_base, key_type, ebay_avg_price, ebay_sold_90d,' +
          '   source, search_query, ebay_median_price, ebay_min_price, ebay_max_price,' +
          '   market_velocity, sales_per_week, top_comps, last_updated, "createdAt")' +
          ' VALUES (gen_random_uuid(), ?, ?, ?, ?, \'market_drip\', ?, ?, ?, ?, ?, ?, ?::jsonb, NOW(), NOW())' +
          ' ON CONFLICT (part_number_base) DO UPDATE SET' +
          '  ebay_avg_price=EXCLUDED.ebay_avg_price, ebay_sold_90d=EXCLUDED.ebay_sold_90d,' +
          '  key_type=EXCLUDED.key_type, source=\'market_drip\', search_query=EXCLUDED.search_query,' +
          '  ebay_median_price=EXCLUDED.ebay_median_price, ebay_min_price=EXCLUDED.ebay_min_price,' +
          '  ebay_max_price=EXCLUDED.ebay_max_price, market_velocity=EXCLUDED.market_velocity,' +
          '  sales_per_week=EXCLUDED.sales_per_week, top_comps=EXCLUDED.top_comps, last_updated=NOW()',
          [cacheKey, keyType, metrics.median, metrics.count, searchQuery, metrics.median, metrics.min, metrics.max, metrics.velocity, metrics.spw, JSON.stringify(metrics.topComps)]
        );
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
          console.log(metrics.count + ' kept, ' + metrics.filtered + ' filtered, $' + metrics.median + ' med' + (keyType === 'keyword' ? ' [KW]' : ''));
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
  console.log('  Keyword searches: ' + kwSearches + ' (' + kwHits + ' hits)');
  console.log('  Next offset: ' + nextOffset + ' / ' + queue.length);
  console.log('  Cache total: ' + stats.rows[0].total + ' (market_drip=' + stats.rows[0].drip + ', old_drip=' + stats.rows[0].old_drip + ')');
  console.log('  Full cycle:  ~' + Math.ceil(queue.length / 600) + ' days (600/day)');
  console.log('═══════════════════════════════════════════');

  await knex.destroy();
}

main().catch(async function(e) { console.error('Fatal:', e.message); await closeBrowser(); process.exit(1); });
