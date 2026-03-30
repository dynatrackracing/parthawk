#!/usr/bin/env node
'use strict';

/**
 * TEST ALL SCRAPERS — Diagnostic dry-run
 *
 * Tests every scraper chain by fetching a small sample from the closest yard.
 * Does NOT write to the database. Reports status, sample vehicles, and field coverage.
 *
 * Usage: node scripts/test-all-scrapers.js
 * Requires: DATABASE_URL env var (or .env file)
 */

const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') }); } catch (e) {}

const axios = require('axios');
const cheerio = require('cheerio');

const CHAINS_TO_TEST = ['LKQ', 'Pull-A-Part', 'Foss', 'Carolina PNP', 'upullandsave', 'chesterfield', 'pickapartva'];
const SAMPLE_LIMIT = 5;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── LKQ: curl + cheerio (no browser) ──────────────────────

async function testLKQ(yard) {
  // Extract slug from scrape_url: https://www.pyp.com/inventory/{slug}/ → slug
  let slug = null;
  if (yard.scrape_url) {
    const m = yard.scrape_url.match(/inventory\/([^\/]+)/);
    if (m) slug = m[1];
  }
  // Fallback: use LKQScraper's hardcoded locations
  if (!slug) {
    const LKQScraper = require('../service/scrapers/LKQScraper');
    const scraper = new LKQScraper();
    const loc = scraper.locations.find(l => l.name === yard.name);
    if (loc) slug = loc.slug;
  }
  if (!slug) throw new Error('Cannot determine LKQ slug for ' + yard.name);

  const url = `https://www.pyp.com/inventory/${slug}/`;
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  const { execSync } = require('child_process');
  const html = execSync(
    `curl -s -L --max-time 30 -H "User-Agent: ${UA}" -H "Accept: text/html,application/xhtml+xml" -H "Referer: https://www.lkqpickyourpart.com/" "${url}"`,
    { maxBuffer: 10 * 1024 * 1024, encoding: 'utf-8' }
  );

  if (html.includes('Just a moment') || html.includes('cf-challenge')) {
    return { status: 'BLOCKED', reason: 'CloudFlare challenge', vehicles: [] };
  }

  const $ = cheerio.load(html);
  const vehicles = [];
  $('div.pypvi_resultRow[id]').each((i, el) => {
    if (vehicles.length >= SAMPLE_LIMIT) return;
    const $row = $(el);
    const ymmText = $row.find('.pypvi_ymm').text().replace(/\s+/g, ' ').trim();
    const ymmMatch = ymmText.match(/^(\d{4})\s+(.+?)\s+(.+)$/);
    if (!ymmMatch) return;

    let color = null, vin = null, row = null, stockNumber = null, dateAdded = null;
    $row.find('.pypvi_detailItem').each((j, detail) => {
      const text = $(detail).text().replace(/\s+/g, ' ').trim();
      if (text.startsWith('Color:')) color = text.replace('Color:', '').trim();
      else if (text.startsWith('VIN:')) vin = text.replace('VIN:', '').trim();
      else if (text.includes('Row:')) { const rm = text.match(/Row:\s*(\S+)/); if (rm) row = rm[1]; }
      else if (text.includes('Stock #:') || text.includes('Stock#:')) stockNumber = text.replace(/Stock\s*#:\s*/, '').trim();
      else if (text.includes('Available:')) { const te = $(detail).find('time'); dateAdded = te.length ? (te.attr('datetime') || te.text().trim()) : text.replace('Available:', '').trim(); }
    });
    vehicles.push({ year: ymmMatch[1], make: ymmMatch[2].trim(), model: ymmMatch[3].trim(), vin, color, row, stockNumber, dateAdded });
  });

  const totalOnPage = $('div.pypvi_resultRow[id]').length;
  return { status: 'OK', vehicles, totalOnPage, fields: ['year', 'make', 'model', 'vin', 'color', 'row', 'stock', 'date'] };
}

// ── U Pull & Save: axios AJAX API (no browser) ────────────

const YARDSMART_IDS = {
  "Bessler's Hebron KY": { yardId: 232, vehicleTypeId: 793 },
  "Bessler's Louisville KY": { yardId: 265, vehicleTypeId: 793 },
  'Bluegrass Lexington KY': { yardId: 595, vehicleTypeId: 793 },
  'Raceway Savannah TN': { yardId: 298, vehicleTypeId: 793 },
};

async function testUPullAndSave(yard) {
  const config = YARDSMART_IDS[yard.name];
  if (!config) throw new Error('Unknown YardSmart ID for ' + yard.name);

  const params = new URLSearchParams();
  params.append('action', 'yardsmart_integration');
  params.append('api_call', 'getInventoryDatatablesArray');
  params.append('params[yard_id]', String(config.yardId));
  params.append('params[vehicle_type_id]', String(config.vehicleTypeId));
  params.append('draw', '1');
  params.append('start', '0');
  params.append('length', String(SAMPLE_LIMIT));

  const response = await axios.post('https://upullandsave.com/wp-admin/admin-ajax.php', params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': 'https://upullandsave.com/',
    },
    timeout: 30000,
  });

  const data = response.data;
  if (!data || !Array.isArray(data.data)) {
    return { status: 'ERROR', reason: 'Unexpected API response format', vehicles: [] };
  }

  const vehicles = data.data.slice(0, SAMPLE_LIMIT).map(row => ({
    year: row.year, make: (row.make || '').toUpperCase(), model: (row.model || '').toUpperCase(),
    vin: row.vin || null, color: row.color || null, row: row.yard_row || null, stockNumber: row.stock_number || null,
  })).filter(r => r.year && r.make);

  return {
    status: 'OK', vehicles, totalOnPage: data.recordsTotal || data.data.length,
    fields: ['year', 'make', 'model', 'vin', 'color', 'row', 'stock'],
  };
}

// ── Playwright scrapers: shared browser test ───────────────

async function testPlaywrightScraper(yard, chain) {
  let chromium;
  try {
    const pw = require('playwright');
    chromium = pw.chromium;
  } catch (e) {
    try { chromium = require('playwright-core').chromium; }
    catch (e2) { return { status: 'SKIP', reason: 'Playwright not installed', vehicles: [] }; }
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
    });
    const page = await context.newPage();

    const url = yard.scrape_url || 'https://example.com';
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const status = resp.status();

    if (status === 403) {
      await context.close();
      return { status: 'BLOCKED', reason: `HTTP 403 — IP blocked`, vehicles: [] };
    }

    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');

    if (bodyText.includes('Cloudflare') || bodyText.includes('Just a moment') || bodyText.includes('Attention Required')) {
      await context.close();
      return { status: 'BLOCKED', reason: 'Cloudflare challenge', vehicles: [] };
    }

    // Try to find vehicles on page
    const vehicles = await page.evaluate((limit) => {
      const results = [];

      // Strategy 1: tables
      const tables = document.querySelectorAll('table');
      for (const table of tables) {
        const rows = table.querySelectorAll('tbody tr, tr');
        for (const row of rows) {
          if (results.length >= limit) break;
          const cells = Array.from(row.querySelectorAll('td'));
          if (cells.length < 3) continue;
          const texts = cells.map(c => c.textContent.trim());
          // Look for a year in any cell
          const yearCell = texts.findIndex(t => /^\d{4}$/.test(t));
          if (yearCell >= 0) {
            results.push({ cells: texts.slice(0, 10) });
          }
        }
        if (results.length > 0) break;
      }

      // Strategy 2: data attributes
      if (results.length === 0) {
        document.querySelectorAll('[data-year], [data-make]').forEach(el => {
          if (results.length >= limit) return;
          results.push({
            year: el.getAttribute('data-year'),
            make: el.getAttribute('data-make'),
            model: el.getAttribute('data-model'),
          });
        });
      }

      return results;
    }, SAMPLE_LIMIT);

    await context.close();

    if (vehicles.length === 0) {
      return { status: 'OK-EMPTY', reason: 'Page loaded but no vehicles parsed (may need form interaction)', vehicles: [], pageTitle: await page.title().catch(() => '') };
    }

    // Normalize vehicle output
    const normalized = vehicles.map(v => {
      if (v.cells) {
        return { raw: v.cells.join(' | ') };
      }
      return v;
    });

    return { status: 'OK', vehicles: normalized, totalOnPage: vehicles.length, fields: Object.keys(vehicles[0] || {}) };
  } catch (err) {
    if (err.message.includes('net::ERR_') || err.message.includes('Timeout')) {
      return { status: 'BLOCKED', reason: err.message.substring(0, 100), vehicles: [] };
    }
    return { status: 'ERROR', reason: err.message.substring(0, 150), vehicles: [] };
  } finally {
    await browser.close();
  }
}

// ── MAIN ───────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log(' TEST ALL SCRAPERS — Diagnostic Dry Run');
  console.log(' Time: ' + new Date().toISOString());
  console.log('═══════════════════════════════════════════════════\n');

  const { database } = require('../service/database/database');
  const results = [];

  for (const chain of CHAINS_TO_TEST) {
    // Get closest enabled yard for this chain
    const yard = await database('yard')
      .where('chain', chain)
      .where('enabled', true)
      .orderBy('distance_from_base', 'asc')
      .first();

    if (!yard) {
      console.log(`=== ${chain} ===`);
      console.log('  No enabled yards found\n');
      results.push({ chain, yard: '-', status: 'NO_YARD', vehicles: 0, hasVin: '-', fields: 0 });
      continue;
    }

    const shortName = yard.name.replace(chain, '').replace(/^\s+/, '').trim() || yard.name;
    console.log(`=== ${chain} (${shortName} — ${yard.distance_from_base}mi) ===`);

    let result;
    try {
      if (chain === 'LKQ') {
        result = await testLKQ(yard);
      } else if (chain === 'upullandsave') {
        result = await testUPullAndSave(yard);
      } else {
        // Playwright-based scrapers
        result = await testPlaywrightScraper(yard, chain);
      }
    } catch (err) {
      result = { status: 'ERROR', reason: err.message.substring(0, 150), vehicles: [] };
    }

    console.log(`  Status: ${result.status}${result.reason ? ' — ' + result.reason : ''}`);
    if (result.totalOnPage) console.log(`  Vehicles on page: ${result.totalOnPage}`);
    if (result.vehicles && result.vehicles.length > 0) {
      console.log(`  Sample (${result.vehicles.length}):`);
      for (const v of result.vehicles.slice(0, SAMPLE_LIMIT)) {
        if (v.raw) {
          console.log(`    ${v.raw}`);
        } else {
          const parts = [v.year, v.make, v.model].filter(Boolean).join(' ');
          const extras = [];
          if (v.vin) extras.push('VIN: ' + v.vin.substring(0, 11) + '...');
          if (v.row) extras.push('Row: ' + v.row);
          if (v.color) extras.push('Color: ' + v.color);
          if (v.stockNumber) extras.push('Stock: ' + v.stockNumber);
          if (v.dateAdded) extras.push('Date: ' + v.dateAdded);
          console.log(`    ${parts}${extras.length ? ' | ' + extras.join(' | ') : ''}`);
        }
      }
    }
    if (result.fields) console.log(`  Fields: ${Array.isArray(result.fields) ? result.fields.join(', ') : result.fields}`);

    const hasVin = result.vehicles?.some(v => v.vin) ? 'YES' : 'NO';
    results.push({
      chain,
      yard: shortName,
      status: result.status,
      vehicles: result.vehicles?.length || 0,
      hasVin: result.status === 'OK' ? hasVin : '-',
      fields: Array.isArray(result.fields) ? result.fields.length : 0,
    });

    console.log('');
    await sleep(3000);
  }

  // Summary table
  console.log('═══════════════════════════════════════════════════');
  console.log(' SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  console.log('');
  console.log('Chain            | Yard                 | Status    | Vehicles | VIN | Fields');
  console.log('-----------------|----------------------|-----------|----------|-----|-------');
  for (const r of results) {
    const chain = r.chain.padEnd(16);
    const yard = r.yard.substring(0, 20).padEnd(20);
    const status = r.status.padEnd(9);
    const veh = String(r.vehicles).padEnd(8);
    const vin = r.hasVin.padEnd(3);
    console.log(`${chain} | ${yard} | ${status} | ${veh} | ${vin} | ${r.fields}`);
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log(' DONE');
  console.log('═══════════════════════════════════════════════════');

  await database.destroy();
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
