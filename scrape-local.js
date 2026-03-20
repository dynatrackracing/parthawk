#!/usr/bin/env node
'use strict';

/**
 * scrape-local.js — Run from Windows PC to bypass CloudFlare
 *
 * Usage:
 *   set DATABASE_URL=postgres://...
 *   node scrape-local.js
 *
 * Scrapes all pages but only saves vehicles added in last 24h.
 * Marks vehicles not seen in scrape as inactive (pulled from yard).
 * Only decodes VINs for new vehicles.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { v4: uuidv4 } = require('uuid');

if (!process.env.DATABASE_URL) {
  console.error('ERROR: set DATABASE_URL=postgres://...\nnode scrape-local.js');
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
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2]));
  const iso = new Date(str);
  return isNaN(iso.getTime()) ? null : iso;
}

function daysAgo(date) {
  if (!date) return 999;
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

// ── SCRAPE ──────────────────────────────────────────────

async function scrapePages(slug) {
  const all = [];
  let page = 1;
  while (page <= 100) {
    const url = page === 1
      ? `https://www.pyp.com/inventory/${slug}/`
      : `https://www.pyp.com/inventory/${slug}/?page=${page}`;
    try {
      const { execSync } = require('child_process');
      const html = execSync(`curl -s -L --max-time 30 -H "User-Agent: ${UA}" -H "Accept: text/html,application/xhtml+xml" -H "Referer: https://www.lkqpickyourpart.com/" "${url}"`, { maxBuffer: 10*1024*1024, encoding: 'utf-8' });
      if (html.includes('Just a moment')) { console.log('  CloudFlare blocked'); break; }
      const $ = cheerio.load(html);
      let n = 0;
      $('div.pypvi_resultRow[id]').each((i, el) => {
        const $r = $(el);
        const ymm = $r.find('.pypvi_ymm').text().replace(/\s+/g,' ').trim();
        const m = ymm.match(/^(\d{4})\s+(.+?)\s+(.+)$/);
        if (!m) return;
        let color=null,vin=null,row=null,stock=null,dateAdded=null;
        $r.find('.pypvi_detailItem').each((j,d)=>{
          const t=$(d).text().replace(/\s+/g,' ').trim();
          if(t.startsWith('Color:'))color=t.replace('Color:','').trim();
          else if(t.startsWith('VIN:'))vin=t.replace('VIN:','').trim();
          else if(t.includes('Row:')){const rm=t.match(/Row:\s*(\S+)/);if(rm)row=rm[1];}
          else if(t.includes('Stock #:')||t.includes('Stock#:'))stock=t.replace(/Stock\s*#:\s*/,'').trim();
          else if(t.includes('Available:')){const te=$(d).find('time');dateAdded=te.length?(te.attr('datetime')||te.text().trim()):t.replace('Available:','').trim();}
        });
        const vehicle = {year:m[1],make:m[2].trim(),model:m[3].trim(),color,vin,row,stock,dateAdded};
        if (all.length === 0) console.log('  FIRST VEHICLE:', JSON.stringify(vehicle));
        all.push(vehicle);
        n++;
      });
      if(n===0)break;
      process.stdout.write(`  Page ${page}: ${n} (total ${all.length})\n`);
      if(!html.includes('Next Page'))break;
      page++;
      await sleep(500);
    } catch(e) { console.log(`  Page ${page} error: ${e.message.substring(0,80)}`); break; }
  }
  return all;
}

// ── SAVE ────────────────────────────────────────────────

async function saveYard(loc, allVehicles) {
  const yard = await knex('yard').where('name', loc.name).first();
  if (!yard) { console.log(`  ERROR: "${loc.name}" not in DB`); return {}; }

  const now = new Date();

  // Build set of all stock numbers seen in this scrape (for inactive marking)
  const seenStocks = new Set();
  const seenYMM = new Set();
  for (const v of allVehicles) {
    if (v.stock) seenStocks.add(v.stock);
    seenYMM.add(`${v.year}|${v.make}|${v.model}`);
  }

  // Analyze date distribution before filtering
  let oldest = null, newest = null, nullDate = 0;
  const ageBuckets = { today: 0, '1d': 0, '2d': 0, '3-7d': 0, '8-30d': 0, '31d+': 0 };
  for (const v of allVehicles) {
    const d = parseDate(v.dateAdded);
    if (!d) { nullDate++; continue; }
    if (!oldest || d < oldest) oldest = d;
    if (!newest || d > newest) newest = d;
    const age = daysAgo(d);
    if (age === 0) ageBuckets.today++;
    else if (age === 1) ageBuckets['1d']++;
    else if (age === 2) ageBuckets['2d']++;
    else if (age <= 7) ageBuckets['3-7d']++;
    else if (age <= 30) ageBuckets['8-30d']++;
    else ageBuckets['31d+']++;
  }
  console.log(`  Date range: ${oldest ? oldest.toISOString().slice(0,10) : 'null'} to ${newest ? newest.toISOString().slice(0,10) : 'null'}`);
  console.log(`  Distribution:`, JSON.stringify(ageBuckets), `null: ${nullDate}`);

  // Filter to only vehicles added in last 48 hours
  const newVehicles = [];
  let oldSkipped = 0;
  for (const v of allVehicles) {
    const d = parseDate(v.dateAdded);
    if (!d) { oldSkipped++; continue; }
    if (daysAgo(d) <= 2) {
      v._date = d;
      newVehicles.push(v);
    } else {
      oldSkipped++;
    }
  }
  console.log(`  >>> SAVING ${newVehicles.length} new vehicles, SKIPPING ${oldSkipped} old vehicles`);

  // Mark vehicles NOT in scrape as inactive (pulled from yard)
  let deactivated = 0;
  try {
    const active = await knex('yard_vehicle').where('yard_id', yard.id).where('active', true).select('id', 'stock_number', 'year', 'make', 'model');
    for (const a of active) {
      const inScrape = (a.stock_number && seenStocks.has(a.stock_number)) ||
                       seenYMM.has(`${a.year}|${a.make}|${a.model}`);
      if (!inScrape) {
        await knex('yard_vehicle').where('id', a.id).update({ active: false, updatedAt: now });
        deactivated++;
      }
    }
    if (deactivated > 0) console.log(`  Deactivated ${deactivated} (not in scrape — pulled from yard)`);
  } catch (e) { console.log(`  Deactivate error: ${e.message}`); }

  // Also re-activate vehicles that ARE in scrape but were inactive
  let reactivated = 0;
  try {
    const inactive = await knex('yard_vehicle').where('yard_id', yard.id).where('active', false).select('id', 'stock_number', 'year', 'make', 'model');
    for (const a of inactive) {
      const inScrape = (a.stock_number && seenStocks.has(a.stock_number)) ||
                       seenYMM.has(`${a.year}|${a.make}|${a.model}`);
      if (inScrape) {
        await knex('yard_vehicle').where('id', a.id).update({ active: true, last_seen: now, updatedAt: now });
        reactivated++;
      }
    }
    if (reactivated > 0) console.log(`  Reactivated ${reactivated} (still on lot)`);
  } catch (e) { console.log(`  Reactivate error: ${e.message}`); }

  // INSERT/UPDATE only new (last 24h) vehicles
  let inserted = 0, updated = 0, errors = 0, vins = 0;
  for (const v of newVehicles) {
    const hasVin = v.vin && v.vin.length >= 11;
    if (hasVin) vins++;
    try {
      let existing = null;
      if (v.stock) {
        existing = await knex('yard_vehicle').where('yard_id', yard.id).where('stock_number', v.stock).first();
      }
      if (!existing) {
        existing = await knex('yard_vehicle').where('yard_id', yard.id).where('year', v.year).where('make', v.make).where('model', v.model).first();
      }

      if (existing) {
        await knex('yard_vehicle').where('id', existing.id).update({
          vin: hasVin ? v.vin : (existing.vin || null),
          color: v.color || existing.color,
          row_number: v.row || existing.row_number,
          stock_number: v.stock || existing.stock_number,
          date_added: v._date || existing.date_added,
          active: true, last_seen: now, scraped_at: now, updatedAt: now,
        });
        updated++;
      } else {
        await knex('yard_vehicle').insert({
          id: uuidv4(), yard_id: yard.id,
          year: v.year, make: v.make, model: v.model, trim: null,
          color: v.color || null, row_number: v.row || null,
          vin: hasVin ? v.vin : null, stock_number: v.stock || null,
          date_added: v._date || null,
          active: true, first_seen: now, last_seen: now,
          scraped_at: now, createdAt: now, updatedAt: now,
        });
        inserted++;
      }
    } catch (e) {
      errors++;
      if (errors <= 3) console.log(`  DB ERROR [${v.year} ${v.make} ${v.model}]: ${e.message}`);
    }
  }

  await knex('yard').where('id', yard.id).update({ last_scraped: now, updatedAt: now });
  console.log(`  SAVED: ${inserted} new, ${updated} updated, ${errors} errors, ${vins} VINs`);
  return { inserted, updated, deactivated, reactivated, errors, vins, newCount: newVehicles.length };
}

// ── VIN DECODE (new vehicles only) ──────────────────────

async function decodeVins() {
  console.log('\n━━━ VIN DECODE (new vehicles only) ━━━');
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let vehicles;
  try {
    vehicles = await knex('yard_vehicle')
      .whereNotNull('vin').where('vin', '!=', '')
      .where(function() { this.where('vin_decoded', false).orWhereNull('vin_decoded'); })
      .where('scraped_at', '>=', cutoff)
      .select('id', 'vin', 'year', 'make', 'model');
  } catch (e) { console.log(`  Query error: ${e.message}`); return; }

  console.log(`  ${vehicles.length} VINs to decode`);
  let decoded = 0, cached = 0, errors = 0;

  for (const v of vehicles) {
    const vin = v.vin.trim().toUpperCase();

    // Cache check
    try {
      const c = await knex('vin_cache').where('vin', vin).first();
      if (c) {
        await knex('yard_vehicle').where('id', v.id).update({
          engine: c.engine ? c.engine.substring(0,50) : null,
          drivetrain: c.drivetrain ? c.drivetrain.substring(0,20) : null,
          trim_level: c.trim ? c.trim.substring(0,100) : null,
          body_style: c.body_style ? c.body_style.substring(0,50) : null,
          vin_decoded: true, updatedAt: new Date(),
        });
        cached++;
        console.log(`  [${cached+decoded+errors}/${vehicles.length}] ${vin} — cached`);
        continue;
      }
    } catch (e) {}

    // NHTSA
    try {
      const res = await axios.get(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${vin}?format=json`, { timeout: 10000 });
      const results = res.data?.Results || [];
      const get = (id) => { const r = results.find(x => x.VariableId === id); const val = r?.Value?.trim(); return (val && val !== '' && val !== 'Not Applicable') ? val : null; };

      const disp = get(13); const rawCyl = get(71); let engine = null;
      if (disp) { const dn = parseFloat(disp); engine = (!isNaN(dn) ? dn.toFixed(1) : disp) + 'L'; const c = parseInt(rawCyl); if (c >= 2 && c <= 16) { const lb = c <= 4 ? '4-cyl' : c === 5 ? '5-cyl' : c === 6 ? 'V6' : c === 8 ? 'V8' : c === 10 ? 'V10' : c + '-cyl'; engine += ' ' + lb; } }

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
          raw_nhtsa: JSON.stringify(results),
          decoded_at: new Date(), createdAt: new Date(),
        }).onConflict('vin').ignore();
      } catch (e) {}

      // Update
      const upd = { vin_decoded: true, updatedAt: new Date() };
      if (engine) upd.engine = engine.substring(0, 50);
      if (engineType) upd.engine_type = engineType.substring(0, 20);
      if (drivetrain) upd.drivetrain = drivetrain.substring(0, 20);
      if (trim) upd.trim_level = trim.substring(0, 100);
      if (bodyStyle) upd.body_style = bodyStyle.substring(0, 50);
      await knex('yard_vehicle').where('id', v.id).update(upd);
      decoded++;
      console.log(`  [${cached+decoded+errors}/${vehicles.length}] ${vin} — ${engine||'?'} ${drivetrain||'?'}`);
      await sleep(200);
    } catch (e) {
      errors++;
      console.log(`  [${cached+decoded+errors}/${vehicles.length}] ${vin} — ERROR: ${e.message}`);
    }
  }
  console.log(`  Done: ${decoded} decoded, ${cached} cached, ${errors} errors`);
}

// ── MAIN ────────────────────────────────────────────────

async function main() {
  console.log('PartHawk Local Scraper');
  console.log('DB:', process.env.DATABASE_URL.replace(/\/\/.*@/, '//***@'));
  console.log('Time:', new Date().toISOString());

  try { await knex.raw('SELECT 1'); console.log('DB: OK'); }
  catch (e) { console.error('DB FAILED:', e.message); process.exit(1); }

  const before = await knex.raw('SELECT COUNT(*) as total, COUNT(vin) as has_vin, SUM(CASE WHEN active THEN 1 ELSE 0 END) as active FROM yard_vehicle');
  console.log('Before:', JSON.stringify(before.rows[0]));

  let totalNew = 0, totalDeactivated = 0;
  for (const loc of LOCATIONS) {
    console.log(`\n━━━ ${loc.name} ━━━`);
    const vehicles = await scrapePages(loc.slug);
    console.log(`  Scraped: ${vehicles.length} total`);
    if (vehicles.length > 0) {
      const r = await saveYard(loc, vehicles);
      totalNew += (r.inserted || 0);
      totalDeactivated += (r.deactivated || 0);
    }
  }

  console.log(`\n━━━ TOTALS: ${totalNew} new vehicles, ${totalDeactivated} deactivated ━━━`);

  await decodeVins();

  const after = await knex.raw('SELECT COUNT(*) as total, COUNT(vin) as has_vin, SUM(CASE WHEN active THEN 1 ELSE 0 END) as active, SUM(CASE WHEN vin_decoded THEN 1 ELSE 0 END) as decoded FROM yard_vehicle');
  console.log('\nAfter:', JSON.stringify(after.rows[0]));

  await knex.destroy();
  console.log('Done!');
}

main().catch(e => { console.error('FATAL:', e.message); knex.destroy(); process.exit(1); });
