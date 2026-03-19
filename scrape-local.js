#!/usr/bin/env node
'use strict';

/**
 * scrape-local.js — Run from Windows PC to bypass CloudFlare
 *
 * Usage:
 *   set DATABASE_URL=postgres://...
 *   node scrape-local.js
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

function parseDate(str) {
  if (!str) return null;
  const iso = new Date(str);
  if (!isNaN(iso.getTime()) && str.includes('-')) return iso;
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2]));
  return null;
}

function daysAgo(date) {
  if (!date) return 999;
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

// ── SCRAPE ALL PAGES ────────────────────────────────────

async function scrapePages(location) {
  const allVehicles = [];
  let page = 1;

  while (page <= 100) {
    const url = page === 1
      ? `https://www.pyp.com/inventory/${location.slug}/`
      : `https://www.pyp.com/inventory/${location.slug}/?page=${page}`;

    try {
      const { execSync } = require('child_process');
      const cmd = `curl -s -L --max-time 30 -H "User-Agent: ${UA}" -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" -H "Referer: https://www.lkqpickyourpart.com/" "${url}"`;
      const html = execSync(cmd, { maxBuffer: 10 * 1024 * 1024, encoding: 'utf-8' });

      if (html.includes('Just a moment') || html.includes('cf-challenge')) {
        console.log('  CloudFlare blocked — stopping');
        break;
      }

      const $ = cheerio.load(html);
      let count = 0;

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
        count++;
      });

      if (count === 0) break;
      process.stdout.write(`  Page ${page}: ${count} (total: ${allVehicles.length})\n`);
      if (!html.includes('Next Page')) break;
      page++;
      await sleep(500);
    } catch (err) {
      console.log(`  Page ${page} error: ${err.message.substring(0, 100)}`);
      break;
    }
  }
  return allVehicles;
}

// ── SAVE TO DB ──────────────────────────────────────────

async function saveYard(location, allVehicles) {
  const yard = await knex('yard').where('name', location.name).first();
  if (!yard) { console.log(`  ERROR: "${location.name}" not in yard table`); return { saved: 0 }; }

  const now = new Date();

  // Step 1: Mark ALL vehicles for this yard inactive
  const deactivated = await knex('yard_vehicle').where('yard_id', yard.id).update({ active: false, updatedAt: now });
  console.log(`  Deactivated ${deactivated} old records for ${location.name}`);

  // Step 2: Upsert each vehicle
  let inserted = 0, updated = 0, errors = 0, vins = 0;

  for (const v of allVehicles) {
    const hasVin = v.vin && v.vin.length >= 11;
    if (hasVin) vins++;
    const parsedDate = parseDate(v.dateAdded);

    try {
      // Try to find existing by stock_number first (most precise), then by year+make+model
      let existing = null;
      if (v.stockNumber) {
        existing = await knex('yard_vehicle')
          .where('yard_id', yard.id)
          .where('stock_number', v.stockNumber)
          .first();
      }
      if (!existing) {
        existing = await knex('yard_vehicle')
          .where('yard_id', yard.id)
          .where('year', v.year)
          .where('make', v.make)
          .where('model', v.model)
          .first();
      }

      if (existing) {
        // UPDATE
        await knex('yard_vehicle').where('id', existing.id).update({
          vin: hasVin ? v.vin : (existing.vin || null),
          color: v.color || existing.color,
          row_number: v.row || existing.row_number,
          stock_number: v.stockNumber || existing.stock_number,
          date_added: parsedDate || existing.date_added,
          active: true,
          last_seen: now,
          scraped_at: now,
          updatedAt: now,
        });
        updated++;
      } else {
        // INSERT
        await knex('yard_vehicle').insert({
          id: uuidv4(),
          yard_id: yard.id,
          year: v.year,
          make: v.make,
          model: v.model,
          trim: null,
          color: v.color || null,
          row_number: v.row || null,
          vin: hasVin ? v.vin : null,
          stock_number: v.stockNumber || null,
          date_added: parsedDate || null,
          active: true,
          first_seen: now,
          last_seen: now,
          scraped_at: now,
          createdAt: now,
          updatedAt: now,
        });
        inserted++;
      }

      // Log every 100th vehicle to show progress
      const total = inserted + updated;
      if (total % 100 === 0 && total > 0) {
        process.stdout.write(`  Progress: ${total}/${allVehicles.length} (${inserted} new, ${updated} upd)\n`);
      }
    } catch (err) {
      errors++;
      if (errors <= 5) {
        console.log(`  DB ERROR [${v.year} ${v.make} ${v.model} stock:${v.stockNumber}]: ${err.message}`);
      } else if (errors === 6) {
        console.log(`  (suppressing further errors...)`);
      }
    }
  }

  // Update yard timestamp
  await knex('yard').where('id', yard.id).update({ last_scraped: now, updatedAt: now });

  console.log(`  SAVED: ${inserted} inserted, ${updated} updated, ${errors} errors, ${vins} VINs`);
  return { inserted, updated, errors, vins };
}

// ── VIN DECODE (last 24h only) ──────────────────────────

async function decodeVins() {
  console.log('\n━━━ VIN DECODE (last 24h vehicles only) ━━━');

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  let vehicles;
  try {
    vehicles = await knex('yard_vehicle')
      .whereNotNull('vin').where('vin', '!=', '')
      .where(function() { this.where('vin_decoded', false).orWhereNull('vin_decoded'); })
      .where('scraped_at', '>=', cutoff)
      .select('id', 'vin', 'year', 'make', 'model');
  } catch (e) {
    console.log(`  Query error: ${e.message}`);
    return;
  }

  console.log(`  ${vehicles.length} VINs to decode`);
  let decoded = 0, cached = 0, errors = 0;

  for (const v of vehicles) {
    const vin = v.vin.trim().toUpperCase();

    // Cache check
    try {
      const c = await knex('vin_cache').where('vin', vin).first();
      if (c) {
        await knex('yard_vehicle').where('id', v.id).update({
          engine: c.engine || null, drivetrain: c.drivetrain || null,
          trim_level: c.trim || null, body_style: c.body_style || null,
          vin_decoded: true, updatedAt: new Date(),
        });
        cached++;
        console.log(`  [${cached+decoded+errors}/${vehicles.length}] ${vin} — cached: ${c.engine||'?'} ${c.drivetrain||'?'}`);
        continue;
      }
    } catch (e) {}

    // NHTSA
    try {
      const res = await axios.get(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${vin}?format=json`, { timeout: 10000 });
      const results = res.data?.Results || [];
      const get = (id) => { const r = results.find(x => x.VariableId === id); const v = r?.Value?.trim(); return (v && v !== '' && v !== 'Not Applicable') ? v : null; };

      const disp = get(13); let engine = null;
      if (disp) { engine = disp.includes('L') ? disp : disp+'L'; const cyl = get(71); if (cyl) engine += ' '+cyl+'cyl'; }
      const ft = (get(24)||'').toLowerCase();
      let engineType = 'Gas';
      if (ft.includes('diesel')) engineType = 'Diesel';
      else if (ft.includes('hybrid')) engineType = 'Hybrid';
      else if (ft.includes('electric') && !ft.includes('hybrid')) engineType = 'Electric';
      const dt = (get(15)||'').toUpperCase();
      let drivetrain = null;
      if (dt.includes('4WD')||dt.includes('4X4')||dt.includes('4-WHEEL')) drivetrain = '4WD';
      else if (dt.includes('AWD')||dt.includes('ALL-WHEEL')||dt.includes('ALL WHEEL')) drivetrain = 'AWD';
      else if (dt.includes('FWD')||dt.includes('FRONT-WHEEL')||dt.includes('FRONT WHEEL')) drivetrain = 'FWD';
      else if (dt.includes('RWD')||dt.includes('REAR-WHEEL')||dt.includes('REAR WHEEL')) drivetrain = 'RWD';
      const trim = get(38), bodyStyle = get(5);

      // Cache
      try {
        await knex('vin_cache').insert({
          vin, year: get(29)?parseInt(get(29)):null, make: get(26), model: get(28),
          trim, engine, drivetrain, body_style: bodyStyle,
          decoded_at: new Date(), createdAt: new Date(),
        }).onConflict('vin').ignore();
      } catch (e) {}

      // Update yard_vehicle
      const upd = { vin_decoded: true, updatedAt: new Date() };
      if (engine) upd.engine = engine;
      if (engineType) upd.engine_type = engineType;
      if (drivetrain) upd.drivetrain = drivetrain;
      if (trim) upd.trim_level = trim;
      if (bodyStyle) upd.body_style = bodyStyle;
      await knex('yard_vehicle').where('id', v.id).update(upd);
      decoded++;
      console.log(`  [${cached+decoded+errors}/${vehicles.length}] ${vin} — ${engine||'?'} ${engineType} ${drivetrain||'?'} ${trim||''}`);
      await sleep(200);
    } catch (err) {
      errors++;
      console.log(`  [${cached+decoded+errors}/${vehicles.length}] ${vin} — ERROR: ${err.message.substring(0,80)}`);
    }
  }
  console.log(`  Done: ${decoded} decoded, ${cached} cached, ${errors} errors`);
}

// ── MAIN ────────────────────────────────────────────────

async function main() {
  console.log('PartHawk Local Scraper');
  console.log('DB:', process.env.DATABASE_URL.replace(/\/\/.*@/, '//***@'));
  console.log('Time:', new Date().toISOString());
  console.log('');

  // Test connection
  try { await knex.raw('SELECT 1'); console.log('DB connection: OK'); }
  catch (e) { console.error('DB FAILED:', e.message); process.exit(1); }

  // Show yards
  const yards = await knex('yard').where('enabled', true).select('name','id');
  console.log(`Yards: ${yards.length}`);
  yards.forEach(y => console.log(`  ${y.name} (${y.id})`));

  // Before counts
  const before = await knex.raw('SELECT COUNT(*) as total, COUNT(vin) as has_vin, SUM(CASE WHEN active THEN 1 ELSE 0 END) as active FROM yard_vehicle');
  console.log(`\nBefore: ${JSON.stringify(before.rows[0])}`);

  // Scrape + save each yard
  let grandTotal = 0;
  for (const loc of LOCATIONS) {
    console.log(`\n━━━ ${loc.name} ━━━`);
    const vehicles = await scrapePages(loc);
    console.log(`  Scraped: ${vehicles.length}`);
    if (vehicles.length > 0) {
      const result = await saveYard(loc, vehicles);
      grandTotal += (result.inserted || 0) + (result.updated || 0);
    }
  }

  console.log(`\n━━━ TOTAL SAVED: ${grandTotal} ━━━`);

  // Decode VINs
  await decodeVins();

  // After counts
  const after = await knex.raw('SELECT COUNT(*) as total, COUNT(vin) as has_vin, SUM(CASE WHEN active THEN 1 ELSE 0 END) as active, SUM(CASE WHEN vin_decoded THEN 1 ELSE 0 END) as decoded FROM yard_vehicle');
  console.log(`\n━━━ FINAL ━━━`);
  console.log(JSON.stringify(after.rows[0], null, 2));

  await knex.destroy();
  console.log('\nDone!');
}

main().catch(err => { console.error('FATAL:', err.message, err.stack); knex.destroy(); process.exit(1); });
