#!/usr/bin/env node
'use strict';

/**
 * scrape-local.js — Run from your Windows PC to bypass CloudFlare
 *
 * Usage:
 *   set DATABASE_URL=postgres://...    (from Railway Variables tab)
 *   node scrape-local.js
 *
 * Scrapes all 4 LKQ yards, stores vehicles with VINs in Railway Postgres,
 * then decodes VINs via NHTSA API.
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

// ── SCRAPE ──────────────────────────────────────────────

async function scrapeYard(location) {
  console.log(`\n━━━ ${location.name} ━━━`);
  const yard = await knex('yard').where('name', location.name).first();
  if (!yard) { console.log('  Yard not in database — skipping'); return { name: location.name, vehicles: 0 }; }

  const vehicles = [];
  let page = 1;

  while (page <= 100) {
    const url = page === 1
      ? `https://www.pyp.com/inventory/${location.slug}/`
      : `https://www.pyp.com/inventory/${location.slug}/?page=${page}`;

    try {
      // Use curl to bypass CloudFlare TLS fingerprinting (axios gets 403)
      const { execSync } = require('child_process');
      const cmd = `curl -s -L --max-time 30 -H "User-Agent: ${UA}" -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" -H "Referer: https://www.lkqpickyourpart.com/" -H "sec-ch-ua-platform: \\"Windows\\"" "${url}"`;
      const html = execSync(cmd, { maxBuffer: 10 * 1024 * 1024, encoding: 'utf-8' });
      if (html.includes('Just a moment')) { console.log('  CloudFlare challenge — retrying...'); break; }
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
          }
        });

        // Photo URL from the main image
        const imgSrc = $row.find('img').attr('src') || null;

        vehicles.push({
          year: ymmMatch[1], make: ymmMatch[2].trim(), model: ymmMatch[3].trim(),
          color, vin, row, stockNumber, dateAdded, photoUrl: imgSrc,
        });
        pageCount++;
      });

      if (pageCount === 0) break;
      process.stdout.write(`  Page ${page}: ${pageCount} vehicles (total: ${vehicles.length})\r`);

      if (!html.includes('Next Page')) break;
      page++;
      await sleep(500);
    } catch (err) {
      console.log(`  Page ${page} error: ${err.message}`);
      break;
    }
  }

  console.log(`  Scraped ${vehicles.length} vehicles from ${page} pages`);

  // Store in database
  const now = new Date();
  await knex('yard_vehicle').where('yard_id', yard.id).where('active', true)
    .update({ active: false, updatedAt: now });

  let inserted = 0, updated = 0, vinsFound = 0;
  for (const v of vehicles) {
    if (v.vin && v.vin.length >= 11) vinsFound++;
    try {
      const existing = await knex('yard_vehicle')
        .where('yard_id', yard.id).where('year', v.year)
        .where('make', v.make).where('model', v.model).first();

      if (existing) {
        const upd = {
          color: v.color || existing.color,
          row_number: v.row || existing.row_number,
          date_added: v.dateAdded || existing.date_added,
          active: true, last_seen: now, scraped_at: now, updatedAt: now,
        };
        if (v.vin && v.vin.length >= 11) upd.vin = v.vin;
        if (v.stockNumber) upd.stock_number = v.stockNumber;
        try { if (v.photoUrl) upd.photo_url = v.photoUrl; } catch (e) {}
        await knex('yard_vehicle').where('id', existing.id).update(upd);
        updated++;
      } else {
        const rec = {
          id: uuidv4(), yard_id: yard.id, year: v.year, make: v.make, model: v.model,
          trim: null, color: v.color || null, row_number: v.row || null,
          date_added: v.dateAdded || null,
          active: true, first_seen: now, last_seen: now,
          scraped_at: now, createdAt: now, updatedAt: now,
        };
        if (v.vin && v.vin.length >= 11) rec.vin = v.vin;
        if (v.stockNumber) rec.stock_number = v.stockNumber;
        try { if (v.photoUrl) rec.photo_url = v.photoUrl; } catch (e) {}
        await knex('yard_vehicle').insert(rec);
        inserted++;
      }
    } catch (err) {
      // ignore insert errors
    }
  }

  await knex('yard').where('id', yard.id).update({ last_scraped: now, updatedAt: now });
  console.log(`  DB: ${inserted} inserted, ${updated} updated, ${vinsFound} VINs captured`);
  return { name: location.name, vehicles: vehicles.length, vinsFound, inserted, updated };
}

// ── VIN DECODE ──────────────────────────────────────────

async function decodeVins() {
  console.log('\n━━━ VIN DECODE ━━━');

  let vehicles;
  try {
    vehicles = await knex('yard_vehicle')
      .whereNotNull('vin').where('vin', '!=', '')
      .where(function() { this.where('vin_decoded', false).orWhereNull('vin_decoded'); })
      .select('id', 'vin')
      .limit(500);
  } catch (e) {
    console.log('  Could not query undecoded VINs:', e.message);
    return { decoded: 0, errors: 0 };
  }

  console.log(`  ${vehicles.length} VINs to decode`);
  let decoded = 0, errors = 0, cached = 0;

  for (const v of vehicles) {
    const vin = v.vin.trim().toUpperCase();

    // Check cache first
    try {
      const c = await knex('vin_cache').where('vin', vin).first();
      if (c) {
        await knex('yard_vehicle').where('id', v.id).update({
          engine: c.engine || null,
          drivetrain: c.drivetrain || null,
          trim_level: c.trim || null,
          body_style: c.body_style || null,
          vin_decoded: true, updatedAt: new Date(),
        });
        cached++;
        continue;
      }
    } catch (e) {}

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

      // Cache
      try {
        await knex('vin_cache').insert({
          vin, year: get(29) ? parseInt(get(29)) : null,
          make: get(26), model: get(28), trim, engine,
          drivetrain, body_style: bodyStyle,
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

      if (decoded % 20 === 0) process.stdout.write(`  Decoded: ${decoded}/${vehicles.length}\r`);
      await sleep(200); // NHTSA rate limit
    } catch (err) {
      errors++;
    }
  }

  console.log(`  Done: ${decoded} decoded, ${cached} from cache, ${errors} errors`);
  return { decoded, cached, errors };
}

// ── MAIN ────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('PartHawk Local Scraper');
  console.log('Database:', process.env.DATABASE_URL.replace(/\/\/.*@/, '//***@'));
  console.log('');

  // Run migrations
  try {
    await knex.migrate.latest({ directory: './service/database/migrations' });
    console.log('Migrations up to date');
  } catch (e) {
    console.log('Migration warning:', e.message.substring(0, 80));
  }

  // Scrape all yards
  const results = [];
  for (const loc of LOCATIONS) {
    const result = await scrapeYard(loc);
    results.push(result);
  }

  // Summary
  console.log('\n━━━ SCRAPE SUMMARY ━━━');
  let totalVehicles = 0, totalVins = 0;
  for (const r of results) {
    console.log(`  ${r.name}: ${r.vehicles} vehicles, ${r.vinsFound} VINs`);
    totalVehicles += r.vehicles || 0;
    totalVins += r.vinsFound || 0;
  }
  console.log(`  TOTAL: ${totalVehicles} vehicles, ${totalVins} VINs`);

  // Decode VINs
  const decodeResult = await decodeVins();

  // Final counts
  const counts = await knex('yard_vehicle').where('active', true).count('* as cnt').first();
  const vinCounts = await knex('yard_vehicle').whereNotNull('vin').where('vin', '!=', '').count('* as cnt').first();
  const decodedCounts = await knex('yard_vehicle').where('vin_decoded', true).count('* as cnt').first();

  console.log('\n━━━ FINAL STATUS ━━━');
  console.log(`  Active vehicles: ${counts?.cnt}`);
  console.log(`  With VIN: ${vinCounts?.cnt}`);
  console.log(`  VIN decoded: ${decodedCounts?.cnt}`);

  await knex.destroy();
  console.log('\nDone!');
}

main().catch(err => {
  console.error('Fatal:', err);
  knex.destroy();
  process.exit(1);
});
