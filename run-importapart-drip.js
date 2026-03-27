#!/usr/bin/env node
'use strict';

/**
 * run-importapart-drip.js - Daily Playwright drip scraper for importapart PNs
 *
 * Fills market_demand_cache gaps from importapart's 7,478 unique part numbers.
 * 100/day split across 3 runs (34/34/33). 15-second delays. Offset tracker.
 *
 * Schedule: 6 AM, 1 PM, 9 PM via run-importapart-drip.bat
 * Queue: ~7,105 net new → 72 days to complete → rolling 75-day refresh
 *
 * Usage: node run-importapart-drip.js [--limit=34] [--test]
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
const { extractPartNumbers } = require('./service/utils/partIntelligence');

const STATE_FILE = path.resolve(__dirname, 'importapart-drip-offset.json');
const DELAY_MS = 15000;
const THIRTY_DAYS_MS = 30 * 86400000;

const args = process.argv.slice(2);
const testMode = args.includes('--test');
const limitIdx = args.indexOf('--limit');
const BATCH_SIZE = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || 34 : (testMode ? 5 : 34);

// ── Playwright scraper ────────────────────────────────────────
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
  } catch (e) { return false; }
}

async function closeBrowser() {
  if (_browser) { try { await _browser.close(); } catch (e) {} _browser = null; _page = null; }
}

async function scrapeSoldComps(query) {
  if (!_page) return [];
  const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&_sacat=6030&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=60`;
  try {
    await _page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await _page.waitForTimeout(2500);
    await _page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await _page.waitForTimeout(1000);

    return await _page.evaluate(() => {
      const results = [];
      const seen = new Set();
      document.querySelectorAll('ul.srp-results > li').forEach(el => {
        try {
          const innerText = el.innerText || '';
          if (innerText.includes('Shop on eBay') || innerText.includes('Results matching fewer words')) return;
          let title = '';
          const ct = el.querySelector('.s-card__title');
          const it = el.querySelector('.s-item__title');
          title = (ct?.textContent || it?.textContent || '').trim().replace(/Opens in a new window or tab$/i, '').trim();
          if (!title) return;
          const cp = el.querySelector('.s-card__price');
          const ip = el.querySelector('.s-item__price');
          const pt = (cp?.textContent || ip?.textContent || '').trim();
          const pm = pt.match(/\$([\d,]+\.?\d*)/);
          if (!pm) return;
          const price = parseFloat(pm[1].replace(',', ''));
          if (isNaN(price) || price <= 0) return;
          const key = title.substring(0, 50) + price;
          if (seen.has(key)) return;
          seen.add(key);
          results.push({ title, price });
        } catch (e) {}
      });
      return results;
    });
  } catch (e) { return []; }
}

// ── V2 axios fallback ─────────────────────────────────────────
let priceCheckV2 = null;
try { priceCheckV2 = require('./service/services/PriceCheckServiceV2'); } catch (e) {}

async function scrapeWithFallback(query) {
  // Primary: Playwright
  if (_page) {
    const items = await scrapeSoldComps(query);
    if (items.length > 0) return items;
  }
  // Fallback: V2 axios
  if (priceCheckV2) {
    try {
      const r = await priceCheckV2.check(query, 0);
      if (r?.metrics?.count > 0) {
        return r.topComps?.map(c => ({ title: c.title, price: c.price })) || [];
      }
    } catch (e) {}
  }
  return [];
}

// ── Metrics ───────────────────────────────────────────────────
function calcMetrics(items) {
  // Filter out our own store sales
  const filtered = items.filter(i => {
    const t = (i.title || '').toLowerCase();
    return !t.includes('dynatrack') && !t.includes('autolumen');
  });
  if (filtered.length === 0) return null;
  const prices = filtered.map(i => i.price).sort((a, b) => a - b);
  const n = prices.length;
  const median = n % 2 === 0 ? (prices[n / 2 - 1] + prices[n / 2]) / 2 : prices[Math.floor(n / 2)];
  return {
    count: n, median: Math.round(median * 100) / 100,
    avg: Math.round(prices.reduce((a, b) => a + b, 0) / n * 100) / 100,
    min: prices[0], max: prices[n - 1],
    velocity: n >= 15 ? 'high' : n >= 8 ? 'medium' : 'low',
    spw: Math.round((n / 90) * 7 * 100) / 100,
    topComps: filtered.slice(0, 5).map(i => ({ title: (i.title || '').substring(0, 80), price: i.price })),
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
  console.log('  DarkHawk - importapart Drip Scraper');
  console.log('  ' + new Date().toISOString());
  console.log('  Batch size: ' + BATCH_SIZE);
  console.log('═══════════════════════════════════════════\n');

  // Step 1: Build full queue
  const items = await knex('Item')
    .where('seller', 'importapart')
    .whereNotNull('manufacturerPartNumber')
    .where('manufacturerPartNumber', '!=', '')
    .select('manufacturerPartNumber', 'title');

  // Deduplicate by base PN
  const pnMap = new Map();
  for (const item of items) {
    const pns = extractPartNumbers(item.manufacturerPartNumber);
    let base, raw;
    if (pns.length > 0) { base = pns[0].base; raw = pns[0].raw; }
    else {
      raw = item.manufacturerPartNumber.trim().toUpperCase();
      base = raw.replace(/[A-Z]{1,2}$/, '');
      if (base.length < 5) base = raw;
    }
    if (!pnMap.has(base)) pnMap.set(base, { pnRaw: raw, base, title: item.title });
  }

  // Filter: skip fresh (<30d) and apify-sourced
  const cached = await knex.raw("SELECT part_number_base, source, last_updated FROM market_demand_cache WHERE ebay_avg_price > 0");
  const cachedMap = new Map();
  for (const r of cached.rows) cachedMap.set(r.part_number_base, r);

  const now = Date.now();
  const queue = [];
  for (const [base, entry] of pnMap) {
    const hit = cachedMap.get(base);
    if (hit) {
      if (hit.source === 'apify') continue; // skip apify
      if (hit.last_updated && (now - new Date(hit.last_updated).getTime()) < THIRTY_DAYS_MS) continue; // fresh
    }
    queue.push(entry);
  }

  // Sort deterministically for offset tracking
  queue.sort((a, b) => a.base.localeCompare(b.base));

  console.log('Queue: ' + queue.length + ' PNs (from ' + pnMap.size + ' unique, ' + (pnMap.size - queue.length) + ' cached/skipped)\n');

  // Step 2: Apply offset
  const state = loadState();
  let offset = state.lastOffset || 0;
  if (offset >= queue.length) { offset = 0; console.log('  Queue wrapped to start\n'); }

  const batch = queue.slice(offset, offset + BATCH_SIZE);
  const nextOffset = (offset + batch.length >= queue.length) ? 0 : offset + batch.length;

  console.log('  Offset: ' + offset + ' → ' + nextOffset + ' (' + batch.length + ' this run)\n');

  // Step 3: Init browser
  const browserOk = await initBrowser();
  console.log('  Playwright: ' + (browserOk ? 'OK' : 'unavailable (V2 fallback)') + '\n');

  // Step 4: Scrape
  let refreshed = 0, skipped = 0, failed = 0;

  for (let i = 0; i < batch.length; i++) {
    const entry = batch[i];
    process.stdout.write(`  [${i + 1}/${batch.length}] ${entry.pnRaw.padEnd(20)}`);

    try {
      const items = await scrapeWithFallback(entry.pnRaw);
      const metrics = calcMetrics(items);

      if (!metrics || metrics.count === 0) {
        console.log('no comps');
        skipped++;
      } else {
        await knex.raw(`
          INSERT INTO market_demand_cache
            (id, part_number_base, ebay_avg_price, ebay_sold_90d,
             source, search_query, ebay_median_price, ebay_min_price, ebay_max_price,
             market_velocity, sales_per_week, top_comps, last_updated, "createdAt")
          VALUES (gen_random_uuid(), ?, ?, ?, 'importapart_drip', ?, ?, ?, ?, ?, ?, ?::jsonb, NOW(), NOW())
          ON CONFLICT (part_number_base) DO UPDATE SET
            ebay_avg_price=EXCLUDED.ebay_avg_price, ebay_sold_90d=EXCLUDED.ebay_sold_90d,
            source='importapart_drip', search_query=EXCLUDED.search_query,
            ebay_median_price=EXCLUDED.ebay_median_price, ebay_min_price=EXCLUDED.ebay_min_price,
            ebay_max_price=EXCLUDED.ebay_max_price, market_velocity=EXCLUDED.market_velocity,
            sales_per_week=EXCLUDED.sales_per_week, top_comps=EXCLUDED.top_comps, last_updated=NOW()
        `, [
          entry.base, metrics.median, metrics.count,
          entry.pnRaw, metrics.median, metrics.min, metrics.max,
          metrics.velocity, metrics.spw, JSON.stringify(metrics.topComps),
        ]);
        console.log(metrics.count + ' comps, $' + metrics.median + ' median');
        refreshed++;
      }
    } catch (e) {
      console.log('ERROR: ' + e.message.substring(0, 40));
      failed++;
    }

    if (i < batch.length - 1) await new Promise(r => setTimeout(r, DELAY_MS));
  }

  // Step 5: Save state
  state.lastOffset = nextOffset;
  state.lastRun = new Date().toISOString();
  state.totalInQueue = queue.length;
  state.completedTotal = (state.completedTotal || 0) + refreshed;
  saveState(state);

  await closeBrowser();

  const stats = await knex.raw("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE source = 'importapart_drip') as drip FROM market_demand_cache");

  console.log('\n═══════════════════════════════════════════');
  console.log('COMPLETE');
  console.log('  Refreshed:   ' + refreshed);
  console.log('  Skipped:     ' + skipped + ' (no comps)');
  console.log('  Failed:      ' + failed);
  console.log('  Next offset: ' + nextOffset + ' / ' + queue.length);
  console.log('  Cache total: ' + stats.rows[0].total + ' (' + stats.rows[0].drip + ' from drip)');
  console.log('  Full cycle:  ' + Math.ceil(queue.length / 100) + ' days remaining');
  console.log('═══════════════════════════════════════════');

  await knex.destroy();
}

main().catch(async e => { console.error('Fatal:', e.message); await closeBrowser(); process.exit(1); });
