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

// ── SCRAPE (with early termination on duplicates) ──────

function parsePage(html) {
  const $ = cheerio.load(html);
  const vehicles = [];
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
    vehicles.push({year:m[1],make:m[2].trim(),model:m[3].trim(),color,vin,row,stock,dateAdded});
  });
  return { vehicles, hasNext: html.includes('Next Page') };
}

async function scrapePages(slug, yardId) {
  const allNew = [];
  let page = 1;
  let consecutiveDupes = 0;
  const DUPE_THRESHOLD = 5; // stop after 5 consecutive duplicates on a page

  while (page <= 100) {
    const url = page === 1
      ? `https://www.pyp.com/inventory/${slug}/`
      : `https://www.pyp.com/inventory/${slug}/?page=${page}`;
    try {
      const { execSync } = require('child_process');
      const html = execSync(`curl -s -L --max-time 30 -H "User-Agent: ${UA}" -H "Accept: text/html,application/xhtml+xml" -H "Referer: https://www.lkqpickyourpart.com/" "${url}"`, { maxBuffer: 10*1024*1024, encoding: 'utf-8' });
      if (html.includes('Just a moment')) { console.log('  CloudFlare blocked'); break; }

      const { vehicles, hasNext } = parsePage(html);
      if (vehicles.length === 0) break;

      // Check each vehicle against DB — newest are first on pyp.com
      let pageNew = 0, pageDupes = 0;
      for (const v of vehicles) {
        let exists = false;

        // Check by stock number (most reliable dedup key)
        if (v.stock && yardId) {
          const hit = await knex('yard_vehicle').where('yard_id', yardId).where('stock_number', v.stock).first('id');
          if (hit) exists = true;
        }
        // Fallback: check by VIN
        if (!exists && v.vin && v.vin.length >= 11 && yardId) {
          const hit = await knex('yard_vehicle').where('yard_id', yardId).where('vin', v.vin).first('id');
          if (hit) exists = true;
        }

        if (exists) {
          pageDupes++;
          consecutiveDupes++;
        } else {
          consecutiveDupes = 0;
          allNew.push(v);
          pageNew++;
        }
      }

      process.stdout.write(`  Page ${page}: ${pageNew} new, ${pageDupes} existing (total new: ${allNew.length})\n`);

      // Early termination: if entire page was duplicates, we've caught up
      if (pageNew === 0) {
        console.log(`  Hit all-duplicate page — caught up. Stopping.`);
        break;
      }
      // Or if we've seen many consecutive dupes (mixed page near the boundary)
      if (consecutiveDupes >= DUPE_THRESHOLD) {
        console.log(`  ${consecutiveDupes} consecutive dupes — caught up. Stopping.`);
        break;
      }

      if (!hasNext) break;
      page++;
      await sleep(500);
    } catch(e) { console.log(`  Page ${page} error: ${e.message.substring(0,80)}`); break; }
  }
  return allNew;
}

// ── SAVE (new vehicles only — dupes already filtered during scraping) ──

async function saveYard(loc, newVehicles, yardId) {
  const now = new Date();

  if (newVehicles.length === 0) {
    await knex('yard').where('id', yardId).update({ last_scraped: now, updatedAt: now });
    console.log(`  No new vehicles to save`);
    return { inserted: 0, errors: 0 };
  }

  console.log(`  Saving ${newVehicles.length} new vehicles`);

  let inserted = 0, errors = 0, vins = 0;
  for (const v of newVehicles) {
    const hasVin = v.vin && v.vin.length >= 11;
    if (hasVin) vins++;
    const dateAdded = v.dateAdded ? new Date(v.dateAdded) : null;
    try {
      await knex('yard_vehicle').insert({
        id: uuidv4(), yard_id: yardId,
        year: v.year, make: v.make, model: v.model, trim: null,
        color: v.color || null, row_number: v.row || null,
        vin: hasVin ? v.vin : null, stock_number: v.stock || null,
        date_added: dateAdded,
        active: true, first_seen: now, last_seen: now,
        scraped_at: now, createdAt: now, updatedAt: now,
      });
      inserted++;
    } catch (e) {
      errors++;
      if (errors <= 3) console.log(`  DB ERROR [${v.year} ${v.make} ${v.model}]: ${e.message.substring(0,60)}`);
    }
  }

  await knex('yard').where('id', yardId).update({ last_scraped: now, updatedAt: now });
  console.log(`  SAVED: ${inserted} new, ${errors} errors, ${vins} VINs`);
  return { inserted, errors, vins };
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

// ── FLYWAY HOOK ────────────────────────────────────────
// After core scrape, check for active Flyway trip yards

async function scrapeFlywayYards(coreYardNames) {
  console.log('\n━━━ FLYWAY CHECK ━━━');
  try {
    const res = await axios.get('https://parthawk-production.up.railway.app/flyway/active-yards', { timeout: 10000 });
    const yards = res.data || [];

    if (!Array.isArray(yards) || yards.length === 0) {
      console.log('  No active Flyway trip yards');
      return;
    }

    // Only LKQ yards (scrape-local.js can only parse LKQ HTML)
    const lkqYards = yards.filter(y =>
      ((y.chain || '').toUpperCase().includes('LKQ')) ||
      ((y.scrape_method || '').toLowerCase() === 'lkq')
    );

    // Skip already-scraped core yards
    const extraYards = lkqYards.filter(y => !coreYardNames.includes(y.name));

    if (extraYards.length === 0) {
      console.log('  No additional LKQ yards to scrape');
      return;
    }

    console.log(`  Scraping ${extraYards.length} Flyway yards: ${extraYards.map(y => y.name).join(', ')}`);

    for (const yard of extraYards) {
      if (!yard.scrape_url) { console.log(`  ${yard.name}: no scrape_url, skipping`); continue; }

      // Extract slug from pyp.com URL: https://www.pyp.com/inventory/{slug}/ → slug
      const slugMatch = yard.scrape_url.match(/pyp\.com\/inventory\/([^\/]+)/);
      if (!slugMatch) { console.log(`  ${yard.name}: can't extract slug from ${yard.scrape_url}, skipping`); continue; }
      const slug = slugMatch[1];

      try {
        console.log(`\n━━━ [FLYWAY] ${yard.name} ━━━`);
        const newVehicles = await scrapePages(slug, yard.id);
        await saveYard({ name: yard.name, slug }, newVehicles, yard.id);

        await knex('yard_vehicle').where('yard_id', yard.id).where('active', true)
          .update({ last_seen: new Date(), updatedAt: new Date() });
      } catch (err) {
        console.error(`  [FLYWAY] Failed ${yard.name}: ${err.message.substring(0, 80)}`);
      }
    }
  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      console.log('  Flyway endpoint unreachable, skipping');
    } else {
      console.log(`  Flyway hook error: ${err.message.substring(0, 80)}`);
    }
  }
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
      // Look up yard ID first (needed for duplicate check during scraping)
      const yard = await knex('yard').where('name', loc.name).first();
      if (!yard) { console.log(`  ERROR: "${loc.name}" not in DB — skipping`); continue; }

      const newVehicles = await scrapePages(loc.slug, yard.id);
      await saveYard(loc, newVehicles, yard.id);

      // Update last_seen for ALL active vehicles in this yard (proves scrape ran)
      await knex('yard_vehicle').where('yard_id', yard.id).where('active', true)
        .update({ last_seen: new Date(), updatedAt: new Date() });
    } catch (e) {
      console.error(`  YARD ERROR [${loc.name}]: ${e.message.substring(0, 100)}`);
    }
  }

  // === FLYWAY HOOK: scrape active trip yards ===
  const coreYardNames = LOCATIONS.map(l => l.name);
  await scrapeFlywayYards(coreYardNames);

  await decodeVins();

  const after = await knex.raw('SELECT COUNT(*) as total, SUM(CASE WHEN active THEN 1 ELSE 0 END) as active, SUM(CASE WHEN vin_decoded THEN 1 ELSE 0 END) as decoded FROM yard_vehicle');
  console.log('\nAfter:', JSON.stringify(after.rows[0]));
  await knex.destroy();
  console.log('Done!');
}

main().catch(e => { console.error('FATAL:', e.message); knex.destroy(); process.exit(1); });
