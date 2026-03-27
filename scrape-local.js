#!/usr/bin/env node
'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { v4: uuidv4 } = require('uuid');

if (!process.env.DATABASE_URL) {
  console.error('set DATABASE_URL=postgres://...\nnode scrape-local.js');
  process.exit(1);
}

const knex = require('knex')({
  client: 'pg',
  connection: { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } },
});

const LOCATIONS = [
  // North Carolina
  { name: 'LKQ Raleigh',    slug: 'raleigh-1168'    },
  { name: 'LKQ Durham',     slug: 'durham-1142'     },
  { name: 'LKQ Greensboro', slug: 'greensboro-1226' },
  { name: 'LKQ East NC',    slug: 'east-nc-1227'    },
  // Florida
  { name: 'LKQ Tampa',      slug: 'tampa-1180'      },
  { name: 'LKQ Largo',      slug: 'largo-1189'      },
  { name: 'LKQ Clearwater', slug: 'clearwater-1190' },
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
        all.push({year:m[1],make:m[2].trim(),model:m[3].trim(),color,vin,row,stock,dateAdded});
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

// ── SAVE (all vehicles) ──────────────────────────────────

async function saveYard(loc, allVehicles) {
  const yard = await knex('yard').where('name', loc.name).first();
  if (!yard) { console.log(`  ERROR: "${loc.name}" not in DB`); return {}; }

  const now = new Date();
  let skipped = 0;

  // Save ALL vehicles — let the display layer filter by date
  const recent = allVehicles.map(v => {
    v._date = v.dateAdded ? new Date(v.dateAdded) : null;
    return v;
  });
  console.log(`  Saving all ${recent.length} vehicles`);

  if (recent.length === 0) {
    // Still mark inactive vehicles not seen in full scrape
    const allStocks = new Set(allVehicles.filter(v => v.stock).map(v => v.stock));
    const deact = await knex('yard_vehicle')
      .where('yard_id', yard.id).where('active', true)
      .whereNotNull('stock_number')
      .whereNotIn('stock_number', [...allStocks])
      .update({ active: false, updatedAt: now });
    if (deact > 0) console.log(`  Deactivated ${deact} (not in scrape)`);
    await knex('yard').where('id', yard.id).update({ last_scraped: now, updatedAt: now });
    console.log(`  No new vehicles to save`);
    return { inserted: 0, updated: 0, skipped };
  }

  // Bulk deactivate vehicles not in full scrape (single query, not per-row)
  const allStocks = new Set(allVehicles.filter(v => v.stock).map(v => v.stock));
  if (allStocks.size > 0) {
    const deact = await knex('yard_vehicle')
      .where('yard_id', yard.id).where('active', true)
      .whereNotNull('stock_number')
      .whereNotIn('stock_number', [...allStocks])
      .update({ active: false, updatedAt: now });
    if (deact > 0) console.log(`  Deactivated ${deact} (not in scrape — pulled)`);
  }

  // INSERT/UPDATE only recent vehicles
  let inserted = 0, updated = 0, errors = 0, vins = 0;
  for (const v of recent) {
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
  return { inserted, updated, errors, vins, skipped };
}

// ── VIN DECODE (recent only) ────────────────────────────

async function decodeVins() {
  console.log('\n━━━ VIN DECODE ━━━');
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  let vehicles;
  try {
    vehicles = await knex('yard_vehicle')
      .whereNotNull('vin').where('vin', '!=', '')
      .where(function() { this.where('vin_decoded', false).orWhereNull('vin_decoded'); })
      .where('scraped_at', '>=', cutoff)
      .select('id', 'vin', 'year', 'make', 'model');
  } catch (e) { console.log(`  Error: ${e.message}`); return; }

  console.log(`  ${vehicles.length} VINs to decode`);
  let decoded = 0, cached = 0, errors = 0;

  for (const v of vehicles) {
    const vin = v.vin.trim().toUpperCase();
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
        continue;
      }
    } catch (e) {}

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

      try {
        await knex('vin_cache').insert({
          vin, year: get(29)?parseInt(get(29)):null, make: get(26), model: get(28),
          trim, engine, drivetrain, body_style: bodyStyle,
          raw_nhtsa: JSON.stringify(results),
          decoded_at: new Date(), createdAt: new Date(),
        }).onConflict('vin').ignore();
      } catch (e) {}

      const upd = { vin_decoded: true, updatedAt: new Date() };
      if (engine) upd.engine = engine.substring(0, 50);
      if (engineType) upd.engine_type = engineType.substring(0, 20);
      if (drivetrain) upd.drivetrain = drivetrain.substring(0, 20);
      if (trim) upd.trim_level = trim.substring(0, 100);
      if (bodyStyle) upd.body_style = bodyStyle.substring(0, 50);
      await knex('yard_vehicle').where('id', v.id).update(upd);
      decoded++;
      console.log(`  [${cached+decoded+errors}/${vehicles.length}] ${vin} ${engine||''} ${drivetrain||''}`);
      await sleep(200);
    } catch (e) {
      errors++;
      console.log(`  [${cached+decoded+errors}/${vehicles.length}] ${vin} ERROR: ${e.message.substring(0,60)}`);
    }
  }
  console.log(`  Done: ${decoded} decoded, ${cached} cached, ${errors} errors`);
}

// ── MAIN ────────────────────────────────────────────────

function parseFloat2(s) { const n = parseFloat(s); return isNaN(n) ? null : n; }

async function main() {
  console.log('PartHawk Local Scraper');
  console.log('Time:', new Date().toISOString());
  try { await knex.raw('SELECT 1'); console.log('DB: OK'); }
  catch (e) { console.error('DB FAILED:', e.message); process.exit(1); }

  const before = await knex.raw('SELECT COUNT(*) as total, SUM(CASE WHEN active THEN 1 ELSE 0 END) as active FROM yard_vehicle');
  console.log('Before:', JSON.stringify(before.rows[0]));

  for (const loc of LOCATIONS) {
    console.log(`\n━━━ ${loc.name} ━━━`);
    try {
      const vehicles = await scrapePages(loc.slug);
      if (vehicles.length > 0) await saveYard(loc, vehicles);
      else console.log('  0 vehicles found — site may be down or blocked');
    } catch (e) {
      console.error(`  YARD ERROR [${loc.name}]: ${e.message.substring(0, 100)}`);
      // Continue to next yard — don't kill the whole run
    }
  }

  await decodeVins();

  const after = await knex.raw('SELECT COUNT(*) as total, SUM(CASE WHEN active THEN 1 ELSE 0 END) as active, SUM(CASE WHEN vin_decoded THEN 1 ELSE 0 END) as decoded FROM yard_vehicle');
  console.log('\nAfter:', JSON.stringify(after.rows[0]));
  await knex.destroy();
  console.log('Done!');
}

main().catch(e => { console.error('FATAL:', e.message); knex.destroy(); process.exit(1); });
