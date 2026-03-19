#!/usr/bin/env node
'use strict';

/**
 * scrape-local.js — Run from your Windows PC to bypass CloudFlare
 *
 * Usage:
 *   set DATABASE_URL=postgres://...    (from Railway Variables tab)
 *   node scrape-local.js
 *
 * Only saves vehicles added in the last 7 days.
 * Only decodes VINs for vehicles added TODAY.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { v4: uuidv4 } = require('uuid');

if (!process.env.DATABASE_URL) {
  console.error('ERROR: Set DATABASE_URL first.\n  set DATABASE_URL=postgres://...\n  node scrape-local.js');
  process.exit(1);
}

const knex = require('knex')({
  client: 'pg',
  connection: { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } },
});

const LOCATIONS = [
  { name: 'LKQ Raleigh',    slug: 'raleigh-1168'    },
  { name: 'LKQ Durham',     slug: 'durham-1142'     },
  { name: 'LKQ Greensboro', slug: 'greensboro-1226' },
  { name: 'LKQ East NC',    slug: 'east-nc-1227'    },
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Parse LKQ date strings like "3/18/2026" or ISO dates
function parseDate(str) {
  if (!str) return null;
  // Try ISO first
  const iso = new Date(str);
  if (!isNaN(iso.getTime())) return iso;
  // Try M/D/YYYY
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2]));
  return null;
}

function daysAgo(date) {
  if (!date) return 999;
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

// ── SCRAPE ──────────────────────────────────────────────

async function scrapeYard(location) {
  console.log(`\n━━━ ${location.name} ━━━`);
  const yard = await knex('yard').where('name', location.name).first();
  if (!yard) {
    console.log('  ERROR: Yard not in database — skipping');
    return { name: location.name, scraped: 0, saved: 0, skipped: 0, errors: 0, vins: 0 };
  }
  console.log(`  Yard ID: ${yard.id}`);

  // Scrape all pages
  const allVehicles = [];
  let page = 1;

  while (page <= 100) {
    const url = page === 1
      ? `https://www.pyp.com/inventory/${location.slug}/`
      : `https://www.pyp.com/inventory/${location.slug}/?page=${page}`;

    try {
      const { execSync } = require('child_process');
      const cmd = `curl -s -L --max-time 30 -H "User-Agent: ${UA}" -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" -H "Referer: https://www.lkqpickyourpart.com/" -H "sec-ch-ua-platform: \\"Windows\\"" "${url}"`;
      const html = execSync(cmd, { maxBuffer: 10 * 1024 * 1024, encoding: 'utf-8' });

      if (html.includes('Just a moment') || html.includes('cf-challenge')) {
        console.log('  CloudFlare challenge — stopping pagination');
        break;
      }

      const $ = cheerio.load(html);
      let pageCount = 0;

      $('div.pypvi_resultRow[id]').each((i, el) => {
        const $row = $(el);
        const ymmText = $row.find('.pypvi_ymm').text().replace(/\s+/g, ' ').trim();
        const ymmMatch = ymmText.match(/^(\d{4})\s+(.+?)\s+(.+)$/);
        if (!ymmMatch) return;

        let color = null, vin = null, row = null, stockNumber = null, dateAdded = null;

        $row.find('.pypvi_detailItem').each((j, detail) => {
          const text = $(detail).text().replace(/\s+/g, ' ').trim();
          if (text.startsWith('Color:')) color = text.replace('Color:', '').trim();
          else if (text.startsWith('VIN:')) vin = text.replace('VIN:', '').trim();
          else if (text.includes('Row:')) { const m = text.match(/Row:\s*(\S+)/); if (m) row = m[1]; }
          else if (text.includes('Stock #:') || text.includes('Stock#:')) stockNumber = text.replace(/Stock\s*#:\s*/, '').trim();
          else if (text.includes('Available:')) {
            const timeEl = $(detail).find('time');
            if (timeEl.length) dateAdded = timeEl.attr('datetime') || timeEl.text().trim();
            else dateAdded = text.replace('Available:', '').trim();
          }
        });

        allVehicles.push({
          year: ymmMatch[1], make: ymmMatch[2].trim(), model: ymmMatch[3].trim(),
          color, vin, row, stockNumber, dateAdded,
        });
        pageCount++;
      });

      if (pageCount === 0) break;
      process.stdout.write(`  Page ${page}: ${pageCount} vehicles (total: ${allVehicles.length})\n`);

      if (!html.includes('Next Page')) break;
      page++;
      await sleep(500);
    } catch (err) {
      console.log(`  Page ${page} fetch error: ${err.message.substring(0, 120)}`);
      break;
    }
  }

  console.log(`  Scraped ${allVehicles.length} vehicles from ${page} pages`);

  // Filter: only vehicles added in last 7 days
  const now = new Date();
  const recentVehicles = [];
  let oldSkipped = 0;

  for (const v of allVehicles) {
    const addedDate = parseDate(v.dateAdded);
    const age = daysAgo(addedDate);
    if (age <= 7) {
      v._parsedDate = addedDate;
      v._daysAgo = age;
      recentVehicles.push(v);
    } else {
      oldSkipped++;
    }
  }

  console.log(`  Filtered: ${recentVehicles.length} in last 7 days, ${oldSkipped} older (skipped)`);

  // Mark all current active vehicles as inactive first
  try {
    const deactivated = await knex('yard_vehicle').where('yard_id', yard.id).where('active', true)
      .update({ active: false, updatedAt: now });
    console.log(`  Deactivated ${deactivated} previously active vehicles`);
  } catch (e) {
    console.log(`  ERROR deactivating: ${e.message}`);
  }

  // Insert/update recent vehicles
  let inserted = 0, updated = 0, errors = 0, vinsFound = 0;

  for (const v of recentVehicles) {
    if (v.vin && v.vin.length >= 11) vinsFound++;

    try {
      // Match on year+make+model+yard (could be multiple of same YMM with different VINs,
      // so also match on stockNumber if available)
      let query = knex('yard_vehicle')
        .where('yard_id', yard.id)
        .where('year', v.year)
        .where('make', v.make)
        .where('model', v.model);

      if (v.stockNumber) {
        query = query.where('stock_number', v.stockNumber);
      }

      const existing = await query.first();

      if (existing) {
        const upd = {
          color: v.color || existing.color,
          row_number: v.row || existing.row_number,
          active: true,
          last_seen: now,
          scraped_at: now,
          updatedAt: now,
        };
        if (v._parsedDate) upd.date_added = v._parsedDate;
        if (v.vin && v.vin.length >= 11) upd.vin = v.vin;
        if (v.stockNumber) upd.stock_number = v.stockNumber;

        await knex('yard_vehicle').where('id', existing.id).update(upd);
        updated++;
      } else {
        const rec = {
          id: uuidv4(),
          yard_id: yard.id,
          year: v.year,
          make: v.make,
          model: v.model,
          trim: null,
          color: v.color || null,
          row_number: v.row || null,
          date_added: v._parsedDate || null,
          active: true,
          first_seen: now,
          last_seen: now,
          scraped_at: now,
          createdAt: now,
          updatedAt: now,
        };
        if (v.vin && v.vin.length >= 11) rec.vin = v.vin;
        if (v.stockNumber) rec.stock_number = v.stockNumber;

        await knex('yard_vehicle').insert(rec);
        inserted++;
      }
    } catch (err) {
      errors++;
      console.log(`  DB ERROR [${v.year} ${v.make} ${v.model}]: ${err.message}`);
    }
  }

  // Update yard last_scraped
  try {
    await knex('yard').where('id', yard.id).update({ last_scraped: now, updatedAt: now });
  } catch (e) {
    console.log(`  ERROR updating yard: ${e.message}`);
  }

  console.log(`  DB: ${inserted} inserted, ${updated} updated, ${errors} errors, ${vinsFound} VINs found`);
  return { name: location.name, scraped: allVehicles.length, saved: inserted + updated, skipped: oldSkipped, errors, vins: vinsFound };
}

// ── VIN DECODE (TODAY only) ─────────────────────────────

async function decodeVins() {
  console.log('\n━━━ VIN DECODE (today only) ━━━');

  // Only decode VINs for vehicles added today (last 24 hours)
  const todayCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  let vehicles;
  try {
    vehicles = await knex('yard_vehicle')
      .whereNotNull('vin')
      .where('vin', '!=', '')
      .where(function() { this.where('vin_decoded', false).orWhereNull('vin_decoded'); })
      .where('scraped_at', '>=', todayCutoff)
      .select('id', 'vin', 'year', 'make', 'model')
      .limit(200);
  } catch (e) {
    console.log(`  ERROR querying undecoded VINs: ${e.message}`);
    return { decoded: 0, errors: 0 };
  }

  console.log(`  ${vehicles.length} today-VINs to decode`);
  if (vehicles.length === 0) return { decoded: 0, cached: 0, errors: 0 };

  let decoded = 0, errors = 0, cached = 0;

  for (const v of vehicles) {
    const vin = v.vin.trim().toUpperCase();
    console.log(`  [${decoded + cached + errors + 1}/${vehicles.length}] ${vin} (${v.year} ${v.make} ${v.model})`);

    // Check cache first
    try {
      const c = await knex('vin_cache').where('vin', vin).first();
      if (c) {
        const upd = { vin_decoded: true, updatedAt: new Date() };
        if (c.engine) upd.engine = c.engine;
        if (c.drivetrain) upd.drivetrain = c.drivetrain;
        if (c.trim) upd.trim_level = c.trim;
        if (c.body_style) upd.body_style = c.body_style;
        await knex('yard_vehicle').where('id', v.id).update(upd);
        cached++;
        console.log(`    Cached: ${c.engine || '?'} ${c.drivetrain || '?'}`);
        continue;
      }
    } catch (e) {
      console.log(`    Cache check error: ${e.message}`);
    }

    // Call NHTSA
    try {
      const res = await axios.get(
        `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${vin}?format=json`,
        { timeout: 10000 }
      );
      const results = res.data?.Results || [];
      const get = (varId) => {
        const item = results.find(r => r.VariableId === varId);
        const val = item?.Value?.trim();
        return (val && val !== '' && val !== 'Not Applicable') ? val : null;
      };

      const displacement = get(13);
      let engine = null;
      if (displacement) {
        engine = displacement.includes('L') ? displacement : displacement + 'L';
        const cyl = get(71);
        if (cyl) engine += ' ' + cyl + 'cyl';
      }

      const fuelType = get(24);
      let engineType = 'Gas';
      if (fuelType) {
        const ft = fuelType.toLowerCase();
        if (ft.includes('diesel')) engineType = 'Diesel';
        else if (ft.includes('hybrid')) engineType = 'Hybrid';
        else if (ft.includes('electric') && !ft.includes('hybrid')) engineType = 'Electric';
      }

      const driveType = get(15);
      let drivetrain = null;
      if (driveType) {
        const dt = driveType.toUpperCase();
        if (dt.includes('4WD') || dt.includes('4X4') || dt.includes('4-WHEEL')) drivetrain = '4WD';
        else if (dt.includes('AWD') || dt.includes('ALL-WHEEL') || dt.includes('ALL WHEEL')) drivetrain = 'AWD';
        else if (dt.includes('FWD') || dt.includes('FRONT-WHEEL') || dt.includes('FRONT WHEEL')) drivetrain = 'FWD';
        else if (dt.includes('RWD') || dt.includes('REAR-WHEEL') || dt.includes('REAR WHEEL')) drivetrain = 'RWD';
      }

      const trim = get(38);
      const bodyStyle = get(5);

      console.log(`    NHTSA: ${engine || '?'} ${engineType} ${drivetrain || '?'} ${trim || ''}`);

      // Cache
      try {
        await knex('vin_cache').insert({
          vin, year: get(29) ? parseInt(get(29)) : null,
          make: get(26), model: get(28), trim, engine,
          drivetrain, body_style: bodyStyle,
          decoded_at: new Date(), createdAt: new Date(),
        }).onConflict('vin').ignore();
      } catch (e) {
        console.log(`    Cache insert error: ${e.message}`);
      }

      // Update yard_vehicle
      const upd = { vin_decoded: true, updatedAt: new Date() };
      if (engine) upd.engine = engine;
      if (engineType) upd.engine_type = engineType;
      if (drivetrain) upd.drivetrain = drivetrain;
      if (trim) upd.trim_level = trim;
      if (bodyStyle) upd.body_style = bodyStyle;

      try {
        await knex('yard_vehicle').where('id', v.id).update(upd);
        decoded++;
      } catch (e) {
        console.log(`    yard_vehicle update error: ${e.message}`);
        errors++;
      }

      await sleep(200); // NHTSA rate limit
    } catch (err) {
      console.log(`    NHTSA error: ${err.message}`);
      errors++;
    }
  }

  console.log(`  Done: ${decoded} decoded, ${cached} from cache, ${errors} errors`);
  return { decoded, cached, errors };
}

// ── MAIN ────────────────────────────────────────────────

async function main() {
  console.log('PartHawk Local Scraper');
  console.log('Database:', process.env.DATABASE_URL.replace(/\/\/.*@/, '//***@'));
  console.log('Time:', new Date().toISOString());
  console.log('');

  // Test DB connection
  try {
    const test = await knex.raw('SELECT 1 as ok');
    console.log('DB connection: OK');
  } catch (e) {
    console.error('DB connection FAILED:', e.message);
    process.exit(1);
  }

  // Check yard count
  try {
    const yards = await knex('yard').where('enabled', true).select('name', 'id');
    console.log(`Yards in DB: ${yards.length}`);
    for (const y of yards) console.log(`  ${y.name} (${y.id})`);
  } catch (e) {
    console.log('Yard query error:', e.message);
  }

  console.log('');

  // Scrape all yards
  const results = [];
  for (const loc of LOCATIONS) {
    const result = await scrapeYard(loc);
    results.push(result);
  }

  // Summary
  console.log('\n━━━ SCRAPE SUMMARY ━━━');
  let totalScraped = 0, totalSaved = 0, totalVins = 0, totalErrors = 0;
  for (const r of results) {
    console.log(`  ${r.name}: scraped ${r.scraped}, saved ${r.saved}, skipped ${r.skipped}, errors ${r.errors}, VINs ${r.vins}`);
    totalScraped += r.scraped || 0;
    totalSaved += r.saved || 0;
    totalVins += r.vins || 0;
    totalErrors += r.errors || 0;
  }
  console.log(`  TOTAL: ${totalScraped} scraped, ${totalSaved} saved, ${totalVins} VINs, ${totalErrors} errors`);

  // Decode VINs (today only)
  await decodeVins();

  // Final counts
  try {
    const active = await knex('yard_vehicle').where('active', true).count('* as cnt').first();
    const withVin = await knex('yard_vehicle').whereNotNull('vin').where('vin', '!=', '').count('* as cnt').first();
    const vinDecoded = await knex('yard_vehicle').where('vin_decoded', true).count('* as cnt').first();
    const total = await knex('yard_vehicle').count('* as cnt').first();

    console.log('\n━━━ FINAL STATUS ━━━');
    console.log(`  Total vehicles in DB: ${total?.cnt}`);
    console.log(`  Active vehicles: ${active?.cnt}`);
    console.log(`  With VIN: ${withVin?.cnt}`);
    console.log(`  VIN decoded: ${vinDecoded?.cnt}`);
  } catch (e) {
    console.log('Final count error:', e.message);
  }

  await knex.destroy();
  console.log('\nDone!');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  console.error(err.stack);
  knex.destroy();
  process.exit(1);
});
