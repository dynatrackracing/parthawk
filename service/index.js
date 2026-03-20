'use strict';

const { log } = require('./lib/logger');
const { Model } = require('objection');
const { database } = require('./database/database');

const schedule = require('node-schedule');
const CronWorkRunner = require('./lib/CronWorkRunner');
const PriceCheckCronRunner = require('./lib/PriceCheckCronRunner');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
dotenv.config();
const { authMiddleware } = require('./middleware/Middleware');

const app = express();
const cors = require('cors')
const PORT = process.env.PORT || 9000;
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(cors());


app.use('/items', require('./routes/items'));
app.use('/cron', require('./routes/cron'));
app.use('/autos', require('./routes/autos'));
app.use('/users', require('./routes/user'));
app.use('/filters', require('./routes/filters'));
app.use('/sync', require('./routes/sync'));
app.use('/intelligence', require('./routes/intelligence'));
app.use('/market-research', require('./routes/market-research'));
app.use('/pricing', require('./routes/pricing'));
app.use('/demand-analysis', require('./routes/demand-analysis'));
app.use('/price-check', require('./routes/price-check'));
app.use('/yards', require('./routes/yards'));
app.use('/attack-list', require('./routes/attack-list'));
app.use('/cogs', require('./routes/cogs'));
// partsLookup mounted first so its /lookup takes priority over old parts.js /lookup
app.use('/api/parts', require('./routes/partsLookup'));
app.use('/api/parts', require('./routes/parts'));
app.use('/api/parts-lookup', require('./routes/partsLookup'));
app.use('/restock', require('./routes/restockReport'));
app.get('/admin/restock', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'restock.html'));
});

// Test LKQ fetch — try both axios and curl from Railway
app.get('/api/test-lkq', async (req, res) => {
  const { execSync } = require('child_process');
  const url = 'https://www.pyp.com/inventory/raleigh-1168/';
  const results = {};

  // Test 1: curl
  try {
    const curlResult = execSync(
      `curl -s -o /dev/null -w "%{http_code}" -L --max-time 10 -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" "${url}"`,
      { encoding: 'utf-8', timeout: 15000 }
    ).trim();
    results.curl_status = curlResult;
  } catch (e) {
    results.curl_error = e.message?.substring(0, 100);
  }

  // Test 2: curl with body
  try {
    const html = execSync(
      `curl -s -L --max-time 10 -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" "${url}"`,
      { maxBuffer: 5 * 1024 * 1024, encoding: 'utf-8', timeout: 15000 }
    );
    results.curl_body_length = html.length;
    results.curl_has_vehicles = html.includes('pypvi_resultRow');
    results.curl_has_cf = html.includes('Just a moment');
    results.curl_title = (html.match(/<title[^>]*>([^<]*)/)||[])[1] || '';
  } catch (e) {
    results.curl_body_error = e.message?.substring(0, 100);
  }

  // Test 3: which curl
  try {
    results.curl_path = execSync('which curl 2>/dev/null || echo "not found"', { encoding: 'utf-8' }).trim();
    results.curl_version = execSync('curl --version 2>/dev/null | head -1', { encoding: 'utf-8' }).trim();
  } catch (e) {
    results.curl_path = 'error: ' + e.message?.substring(0, 50);
  }

  res.json(results);
});

// Decode all undecoded VINs in yard_vehicle
app.post('/api/decode-vins', async (req, res) => {
  try {
    const VinDecodeService = require('./services/VinDecodeService');
    const service = new VinDecodeService();
    const result = await service.decodeAllUndecoded();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Build scrape queue from sales data
app.post('/api/build-scrape-queue', async (req, res) => {
  try {
    const { buildQueue } = require('./scripts/buildScrapeQueue');
    const result = await buildQueue();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.use('/part-location', require('./routes/part-location'));
app.use('/vin', require('./routes/vin'));
app.use('/stale-inventory', require('./routes/stale-inventory'));
app.use('/competitors', require('./routes/competitors'));
app.use('/trim-intelligence', require('./routes/trim-intelligence'));
// Serve static admin tools
app.use('/admin', express.static(path.resolve(__dirname, 'public')));
app.get('/admin/import', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'import.html'));
});
// Attack list - public, no auth required (puller-facing)
app.get('/puller', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'attack-list.html'));
});
app.get('/admin/pull', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'attack-list.html'));
});
app.get('/admin/gate', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'gate.html'));
});
app.get('/admin/vin', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'vin-scanner.html'));
});
// private routes for admin only
app.use('/private', require('./routes/private'));
app.get('/test', (req, res) => {
  res.json('haribol');
});

// Build Auto + AutoItemCompatibility from uploaded JSON with clean _year/_make/_model
// Body: { records: [{ id, ebayId, _year, _make, _model }], clearFirst: true }
app.post('/api/build-auto-index', async (req, res) => {
  const { database } = require('./database/database');
  const { v4: uuidv4 } = require('uuid');
  try {
    const { records, clearFirst } = req.body || {};

    // If clearFirst, wipe the bad title-parsed data
    if (clearFirst) {
      await database('AutoItemCompatibility').delete();
      await database('Auto').delete();
    }

    // If no records, just return counts
    if (!records || !Array.isArray(records) || records.length === 0) {
      const ac = await database('Auto').count('* as cnt').first();
      const lc = await database('AutoItemCompatibility').count('* as cnt').first();
      return res.json({ success: true, cleared: !!clearFirst, totalAutos: parseInt(ac?.cnt||0), totalLinks: parseInt(lc?.cnt||0) });
    }

    const autoCache = {};
    let autosCreated = 0, linksCreated = 0, skipped = 0, errors = 0;

    for (const r of records) {
      const year = parseInt(r._year);
      const make = (r._make || '').trim();
      const model = (r._model || '').trim();
      const itemId = r.id;

      if (!year || year < 1990 || year > 2030 || !make || !model || !itemId) { skipped++; continue; }

      const engine = 'N/A';
      const ak = `${year}|${make}|${model}`;
      let autoId = autoCache[ak];
      if (!autoId) {
        const ex = await database('Auto').where({ year, make, model, engine }).first();
        if (ex) { autoId = ex.id; }
        else {
          autoId = uuidv4();
          try {
            await database('Auto').insert({ id: autoId, year, make, model, trim: '', engine, createdAt: new Date(), updatedAt: new Date() });
            autosCreated++;
          } catch (e) {
            const f = await database('Auto').where({ year, make, model, engine }).first();
            autoId = f?.id || autoId;
          }
        }
        autoCache[ak] = autoId;
      }

      try {
        const le = await database('AutoItemCompatibility').where({ autoId, itemId }).first();
        if (!le) {
          await database('AutoItemCompatibility').insert({ autoId, itemId, createdAt: new Date() });
          linksCreated++;
        }
      } catch (e) { errors++; }
    }

    const ac = await database('Auto').count('* as cnt').first();
    const lc = await database('AutoItemCompatibility').count('* as cnt').first();
    res.json({ success: true, processed: records.length, autosCreated, linksCreated, skipped, errors, totalAutos: parseInt(ac?.cnt||0), totalLinks: parseInt(lc?.cnt||0) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// Full diagnostic — raw SQL queries against production database
app.get('/api/debug/full', async (req, res) => {
  const { database } = require('./database/database');
  const results = {};
  const q = async (label, sql) => {
    try { const r = await database.raw(sql); results[label] = r.rows || r; }
    catch (e) { results[label] = { ERROR: e.message }; }
  };

  await q('all_tables', "SELECT schemaname, tablename, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC");
  await q('yard_vehicle_schema', "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'yard_vehicle' ORDER BY ordinal_position");
  await q('yard_vehicle_sample', "SELECT * FROM yard_vehicle ORDER BY scraped_at DESC LIMIT 3");
  await q('yard_vehicle_vin_status', "SELECT COUNT(*) as total, COUNT(vin) as has_vin, SUM(CASE WHEN vin_decoded = true THEN 1 ELSE 0 END) as decoded FROM yard_vehicle");
  await q('your_sale_90d', "SELECT COUNT(*) as count, ROUND(SUM(\"salePrice\"::numeric), 2) as revenue FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '90 days'");
  await q('your_sale_180d', "SELECT COUNT(*) as count FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '180 days'");
  await q('your_sale_sample', "SELECT title, \"salePrice\", \"soldDate\" FROM \"YourSale\" ORDER BY \"soldDate\" DESC LIMIT 3");
  await q('your_listing_active', "SELECT COUNT(*) as count FROM \"YourListing\" WHERE \"listingStatus\" = 'Active'");
  await q('your_listing_sample', "SELECT title, \"currentPrice\", \"quantityAvailable\", sku FROM \"YourListing\" WHERE \"listingStatus\" = 'Active' LIMIT 3");
  await q('your_sale_schema', "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'YourSale' ORDER BY ordinal_position");
  await q('your_listing_schema', "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'YourListing' ORDER BY ordinal_position");
  await q('item_schema', "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Item' ORDER BY ordinal_position");
  await q('item_sample', "SELECT title, price, seller, \"manufacturerPartNumber\" FROM \"Item\" LIMIT 3");
  await q('platform_group_count', "SELECT COUNT(*) as count FROM platform_group");
  await q('platform_group_sample', "SELECT * FROM platform_group LIMIT 5");
  await q('platform_vehicle_count', "SELECT COUNT(*) as count FROM platform_vehicle");
  await q('platform_shared_part_count', "SELECT COUNT(*) as count FROM platform_shared_part");
  await q('mustang_sales', "SELECT title, \"salePrice\", \"soldDate\" FROM \"YourSale\" WHERE title ILIKE '%mustang%' ORDER BY \"soldDate\" DESC LIMIT 5");
  await q('mustang_stock', "SELECT title, \"currentPrice\", \"quantityAvailable\" FROM \"YourListing\" WHERE title ILIKE '%mustang%' AND \"listingStatus\" = 'Active' LIMIT 5");
  await q('dodge_ram_sales_90d', "SELECT title, \"salePrice\", \"soldDate\" FROM \"YourSale\" WHERE title ILIKE '%dodge%' AND title ILIKE '%ram%' AND \"soldDate\" >= NOW() - INTERVAL '90 days' ORDER BY \"soldDate\" DESC LIMIT 5");
  await q('auto_sample', "SELECT year, make, model, engine FROM \"Auto\" LIMIT 5");
  await q('auto_item_compat_sample', "SELECT a.year, a.make, a.model, i.title, i.price FROM \"Auto\" a JOIN \"AutoItemCompatibility\" aic ON a.id = aic.\"autoId\" JOIN \"Item\" i ON aic.\"itemId\" = i.id LIMIT 5");

  res.json(results);
});

// One-time dedup YourSale — removes duplicate ebayItemId+soldDate rows
app.post('/api/admin/dedup-sales', async (req, res) => {
  const { database } = require('./database/database');
  try {
    const before = await database.raw('SELECT COUNT(*) as count FROM "YourSale"');
    const before90 = await database.raw('SELECT COUNT(*) as count, ROUND(SUM("salePrice"::numeric),2) as revenue FROM "YourSale" WHERE "soldDate" >= NOW() - INTERVAL \'90 days\'');

    // Delete duplicates: keep the row with the smallest id (first inserted)
    // Round 1: same ebayItemId + same soldDate
    await database.raw(`
      DELETE FROM "YourSale" a USING "YourSale" b
      WHERE a.id > b.id
        AND a."ebayItemId" = b."ebayItemId"
        AND a."soldDate"::date = b."soldDate"::date
    `);
    // Round 2: same ebayItemId (item can only be sold once)
    await database.raw(`
      DELETE FROM "YourSale" a USING "YourSale" b
      WHERE a.id > b.id
        AND a."ebayItemId" = b."ebayItemId"
    `);
    // Round 3: same title + same salePrice + same soldDate (different ebayItemId but same transaction)
    const deleted = await database.raw(`
      DELETE FROM "YourSale" a USING "YourSale" b
      WHERE a.id > b.id
        AND a.title = b.title
        AND a."salePrice" = b."salePrice"
        AND a."soldDate"::date = b."soldDate"::date
    `);

    const after = await database.raw('SELECT COUNT(*) as count FROM "YourSale"');
    const after90 = await database.raw('SELECT COUNT(*) as count, ROUND(SUM("salePrice"::numeric),2) as revenue FROM "YourSale" WHERE "soldDate" >= NOW() - INTERVAL \'90 days\'');

    res.json({
      success: true,
      before: { total: before.rows[0].count, ...before90.rows[0] },
      after: { total: after.rows[0].count, ...after90.rows[0] },
      deleted: parseInt(before.rows[0].count) - parseInt(after.rows[0].count),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Re-format engine strings for already-decoded vehicles (fix "210cyl" → "V6")
// Also retry decoding for failed VINs
app.post('/api/admin/fix-engines', async (req, res) => {
  const { database } = require('./database/database');
  try {
    // Step 1: Fix engine strings — re-parse from vin_cache for ALL decoded vehicles
    // Targets: "2.2L 170cyl" (hp not cyl), "3.5L" (missing V6), raw decimals
    const decoded = await database('yard_vehicle')
      .where('vin_decoded', true)
      .whereNotNull('vin')
      .select('id', 'vin', 'engine');

    let fixed = 0, cacheHits = 0;
    for (const v of decoded) {
      // Re-format ALL engines that are missing cylinder labels or have bad ones
      const needsFix = !v.engine || !/(V6|V8|V10|V12|4-cyl|5-cyl)/.test(v.engine) || /\d{2,3}cyl/.test(v.engine);
      if (needsFix) {
        // Look up vin_cache for raw NHTSA data to re-parse
        try {
          const cached = await database('vin_cache').where('vin', v.vin.trim().toUpperCase()).first();
          if (cached && cached.raw_nhtsa) {
            let results;
            try { results = JSON.parse(cached.raw_nhtsa); } catch(e) { continue; }
            if (!Array.isArray(results)) continue;
            const get = (varId) => { const r = results.find(x => x.VariableId === varId); const val = r?.Value?.trim(); return (val && val !== '' && val !== 'Not Applicable') ? val : null; };
            const disp = get(13), cyl = get(71);
            if (disp) {
              const dn = parseFloat(disp);
              let eng = (!isNaN(dn) ? dn.toFixed(1) : disp) + 'L';
              const cn = parseInt(cyl);
              if (cn >= 2 && cn <= 16) {
                const lb = cn <= 4 ? '4-cyl' : cn === 5 ? '5-cyl' : cn === 6 ? 'V6' : cn === 8 ? 'V8' : cn === 10 ? 'V10' : cn === 12 ? 'V12' : cn + '-cyl';
                eng += ' ' + lb;
              }
              await database('yard_vehicle').where('id', v.id).update({ engine: eng.substring(0, 50), updatedAt: new Date() });
              fixed++;
            }
            cacheHits++;
          }
        } catch (e) { /* skip */ }
      }
    }

    // Step 2: Count remaining undecoded
    const undecoded = await database('yard_vehicle')
      .whereNotNull('vin').where('vin', '!=', '')
      .where(function() { this.where('vin_decoded', false).orWhereNull('vin_decoded'); })
      .count('* as cnt').first();

    res.json({ success: true, enginesFixed: fixed, cacheChecked: cacheHits, stillUndecoded: parseInt(undecoded?.cnt || 0) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// One-time: backfill Auto table from YourSale titles
app.post('/api/admin/backfill-auto', async (req, res) => {
  const { database } = require('./database/database');
  const { v4: uuidv4 } = require('uuid');
  try {
    const MAKES = ['Acura','Audi','BMW','Buick','Cadillac','Chevrolet','Chrysler','Dodge','Fiat','Ford','Genesis','GMC','Honda','Hummer','Hyundai','Infiniti','Isuzu','Jaguar','Jeep','Kia','Land Rover','Lexus','Lincoln','Mazda','Mercedes-Benz','Mercury','Mini','Mitsubishi','Nissan','Oldsmobile','Pontiac','Porsche','Ram','Saab','Saturn','Scion','Subaru','Suzuki','Toyota','Volkswagen','Volvo'];
    const STOP = new Set(['ECU','ECM','PCM','BCM','TCM','ABS','TIPM','OEM','NEW','USED','REMAN','Engine','Body','Control','Module','Anti','Fuse','Power','Brake','Amplifier','Radio','Cluster','Steering','Throttle','Programmed','Plug','Play','AT','MT','4WD','AWD','2WD','FWD','RWD','EX','LX','DX','SE','LE','XLE','SXT','RT','GT','LT','LS','SS','SL','SV','SR','SR5','Limited','Sport','Base','Touring','Laredo','Overland','Trailhawk','Sahara','Rubicon','Premium','Platinum','Hybrid','Diesel','Hemi','Turbo','Supercharged','Sedan','Coupe','Hatchback','Wagon','Van','Cab','Crew','Access','Double','Regular','Extended','SuperCrew','SuperCab','Short','Long','Bed','4dr','2dr','V6','V8','Dodge','Chrysler','Jeep','Ford','Chevy','Toyota','Honda','Nissan','Kia','Hyundai','Lincoln','Mercury','Mazda','Subaru','BMW','Audi','Acura','Lexus','Infiniti','GMC','Buick','Cadillac','Saturn','Pontiac','Volvo','VW','Volkswagen','Mini','Scion','Ram','Mitsubishi','Isuzu','Suzuki','Fiat','Jaguar','Porsche','Saab','Genesis','Hummer','Land','Rover','Oldsmobile']);

    // Load all existing Auto year+make+model
    const existing = new Set();
    const autos = await database('Auto').select('year','make','model');
    for (const a of autos) existing.add(`${a.year}|${a.make}|${a.model}`);
    const beforeCount = existing.size;

    // Parse YourSale titles
    const sales = await database('YourSale').whereNotNull('title').select('title');
    const toInsert = new Map(); // key → {year, make, model}

    for (const sale of sales) {
      const t = sale.title || '';
      // Extract year
      const ym = t.match(/\b((?:19|20)\d{2})\b/);
      if (!ym) continue;
      const year = parseInt(ym[1]);
      if (year < 1990 || year > 2030) continue;

      // Extract make
      const tu = t.toUpperCase();
      let make = null;
      for (const mk of MAKES) {
        if (tu.includes(mk.toUpperCase())) { make = mk; break; }
      }
      if (!make) continue;
      if (make === 'Chevy') make = 'Chevrolet';
      if (make === 'VW') make = 'Volkswagen';

      // Extract model: words after make, before stop word/engine/year
      // Keep compound models (Grand Cherokee, CR-V, Ram 1500) but stop at trims
      const COMPOUNDS = new Set(['GRAND','TOWN','LAND']);
      const makeIdx = tu.indexOf(make.toUpperCase());
      const after = t.substring(makeIdx + make.length).trim().split(/\s+/);
      const mw = [];
      for (const w of after) {
        const clean = w.replace(/[^A-Za-z0-9\-]/g, '');
        if (/^\d{4}$/.test(clean) || /^\d+\.\d+[lL]?$/.test(clean)) break;
        if (STOP.has(clean) || STOP.has(clean.toUpperCase())) break;
        mw.push(clean);
        // Only take 2nd word if first is a compound prefix (Grand, Town, Land)
        if (mw.length === 1 && COMPOUNDS.has(clean.toUpperCase())) continue;
        // Also keep 2nd word if it's a number (Ram 1500, F-150)
        if (mw.length === 2 && /^\d/.test(clean)) break;
        if (mw.length >= 1 && !COMPOUNDS.has(mw[0].toUpperCase())) break;
        if (mw.length >= 2) break;
      }
      if (mw.length === 0 || mw[0].length < 2) continue;
      let model = mw.join(' ').trim();
      if (model.length < 2 || model.length > 30) continue;

      const key = `${year}|${make}|${model}`;
      if (!existing.has(key) && !toInsert.has(key)) {
        toInsert.set(key, { year: String(year), make, model });
      }
    }

    // Batch insert
    let inserted = 0, errors = 0;
    for (const [key, v] of toInsert) {
      try {
        // Double-check not exists (race condition safety)
        const ex = await database('Auto').where({ year: v.year, make: v.make, model: v.model }).first();
        if (!ex) {
          await database('Auto').insert({ id: uuidv4(), year: v.year, make: v.make, model: v.model, trim: '', engine: 'N/A', createdAt: new Date(), updatedAt: new Date() });
          inserted++;
        }
      } catch (e) { errors++; }
    }

    // Cleanup: delete bad entries from previous backfill (multi-word non-compound models)
    const VALID_COMPOUNDS = new Set(['Grand Cherokee','Grand Caravan','Grand Prix','Town & Country','Town Country','Land Cruiser','Ram 1500','Ram 2500','Ram 3500','CR-V','CX-5','CX-9','HR-V','RAV4','4Runner','F-150','F-250','F-350','Super Duty','Monte Carlo','Park Avenue','El Camino','Trans Am','Le Sabre']);
    let cleaned = 0;
    try {
      const allAutos = await database('Auto').where('engine', 'N/A').select('id', 'model');
      for (const a of allAutos) {
        if (a.model && a.model.includes(' ') && !VALID_COMPOUNDS.has(a.model)) {
          // Multi-word model that's not a known compound — delete it
          await database('Auto').where('id', a.id).delete();
          cleaned++;
        }
      }
    } catch (e) { /* ignore cleanup errors */ }

    // Direct insert of commonly missing vehicles
    const MISSING = [
      ['Honda','Civic'],['Honda','Accord'],['Honda','Odyssey'],['Honda','Prelude'],['Honda','Element'],['Honda','Fit'],['Honda','Pilot'],
      ['Toyota','Camry'],['Toyota','Corolla'],['Toyota','Tacoma'],['Toyota','Tundra'],['Toyota','4Runner'],['Toyota','Sienna'],['Toyota','Highlander'],['Toyota','Matrix'],['Toyota','Prius'],['Toyota','Avalon'],['Toyota','Celica'],
      ['Nissan','Altima'],['Nissan','Maxima'],['Nissan','Sentra'],['Nissan','Pathfinder'],['Nissan','Frontier'],['Nissan','Xterra'],['Nissan','Murano'],['Nissan','Rogue'],['Nissan','Versa'],['Nissan','Quest'],
      ['Ford','Mustang'],['Ford','Explorer'],['Ford','Expedition'],['Ford','Ranger'],['Ford','Focus'],['Ford','Taurus'],['Ford','Escape'],['Ford','Crown Victoria'],
      ['Chevrolet','Impala'],['Chevrolet','Malibu'],['Chevrolet','Cruze'],['Chevrolet','Cobalt'],['Chevrolet','Cavalier'],['Chevrolet','Monte Carlo'],['Chevrolet','Blazer'],['Chevrolet','TrailBlazer'],['Chevrolet','Colorado'],
      ['Dodge','Durango'],['Dodge','Dakota'],['Dodge','Neon'],['Dodge','Stratus'],['Dodge','Intrepid'],['Dodge','Caravan'],
      ['Hyundai','Elantra'],['Hyundai','Sonata'],['Hyundai','Tucson'],['Hyundai','Santa Fe'],['Hyundai','Accent'],
      ['Kia','Optima'],['Kia','Sorento'],['Kia','Sportage'],['Kia','Soul'],['Kia','Forte'],['Kia','Rio'],
    ];
    let directInserted = 0;
    for (const [mk, md] of MISSING) {
      for (let yr = 1995; yr <= 2025; yr++) {
        const key = `${yr}|${mk}|${md}`;
        if (!existing.has(key)) {
          try {
            const ex = await database('Auto').where({ year: String(yr), make: mk, model: md }).first();
            if (!ex) {
              await database('Auto').insert({ id: uuidv4(), year: String(yr), make: mk, model: md, trim: '', engine: 'N/A', createdAt: new Date(), updatedAt: new Date() });
              directInserted++;
            }
          } catch (e) { /* dup */ }
        }
      }
    }

    // Flush the cache so dropdowns show new data immediately
    try {
      const CacheManager = require('./middleware/CacheManager');
      const cm = new CacheManager();
      cm.flush();
    } catch (e) { /* ignore */ }

    const afterCount = await database('Auto').count('* as cnt').first();

    res.json({
      success: true,
      before: beforeCount,
      after: parseInt(afterCount?.cnt || 0),
      parsed: toInsert.size,
      inserted,
      errors,
      cleaned,
      sample: [...toInsert.values()].slice(0, 20),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Check which eBay env vars are configured (names only, not values)
app.get('/api/debug/env-check', async (req, res) => {
  const keys = ['TRADING_API_TOKEN','TRADING_API_DEV_NAME','TRADING_API_APP_NAME','TRADING_API_CERT_NAME','FINDINGS_APP_NAME','EBAY_TOKEN','ANTHROPIC_API_KEY','DATABASE_URL'];
  const result = {};
  for (const k of keys) {
    result[k] = process.env[k] ? `SET (${process.env[k].length} chars)` : 'NOT SET';
  }
  res.json(result);
});

// Full raw SQL diagnostic — replaces old debug/makes
app.get('/api/debug/makes', async (req, res) => {
  const { database } = require('./database/database');
  const R = {};
  const q = async (k, sql) => { try { const r = await database.raw(sql); R[k] = r.rows || r; } catch(e) { R[k] = {ERROR: e.message}; } };
  try {
    await q('all_tables', "SELECT tablename, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC");
    await q('yard_vehicle_schema', "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'yard_vehicle' ORDER BY ordinal_position");
    await q('yard_vehicle_sample', "SELECT * FROM yard_vehicle ORDER BY scraped_at DESC LIMIT 3");
    await q('yard_vehicle_vin_status', "SELECT COUNT(*) as total, COUNT(vin) as has_vin, SUM(CASE WHEN vin_decoded = true THEN 1 ELSE 0 END) as decoded FROM yard_vehicle");
    await q('your_sale_schema', "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'YourSale' ORDER BY ordinal_position");
    await q('your_sale_90d', "SELECT COUNT(*) as count, ROUND(SUM(\"salePrice\"::numeric), 2) as revenue, ROUND(AVG(\"salePrice\"::numeric), 2) as avg_price FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '90 days'");
    await q('your_sale_180d', "SELECT COUNT(*) as count FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '180 days'");
    await q('your_sale_sample', "SELECT title, \"salePrice\", \"soldDate\" FROM \"YourSale\" WHERE title IS NOT NULL ORDER BY \"soldDate\" DESC LIMIT 3");
    await q('your_listing_schema', "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'YourListing' ORDER BY ordinal_position");
    await q('your_listing_active', "SELECT COUNT(*) as count FROM \"YourListing\" WHERE \"listingStatus\" = 'Active'");
    await q('your_listing_sample', "SELECT title, \"currentPrice\", \"quantityAvailable\", sku FROM \"YourListing\" WHERE \"listingStatus\" = 'Active' LIMIT 3");
    await q('item_schema', "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Item' ORDER BY ordinal_position");
    await q('item_sample', "SELECT title, price, seller, \"manufacturerPartNumber\" FROM \"Item\" LIMIT 3");
    await q('platform_counts', "SELECT (SELECT COUNT(*) FROM platform_group) as groups, (SELECT COUNT(*) FROM platform_vehicle) as vehicles, (SELECT COUNT(*) FROM platform_shared_part) as shared_parts");
    await q('platform_sample', "SELECT pg.name, pg.platform, pg.year_start, pg.year_end FROM platform_group pg LIMIT 5");
    await q('mustang_sales', "SELECT title, \"salePrice\", \"soldDate\" FROM \"YourSale\" WHERE title ILIKE '%mustang%' ORDER BY \"soldDate\" DESC LIMIT 5");
    await q('mustang_stock', "SELECT title, \"currentPrice\", \"quantityAvailable\" FROM \"YourListing\" WHERE title ILIKE '%mustang%' AND \"listingStatus\" = 'Active' LIMIT 5");
    await q('dodge_ram_sales_90d', "SELECT title, \"salePrice\", \"soldDate\" FROM \"YourSale\" WHERE title ILIKE '%dodge%' AND title ILIKE '%ram%' AND \"soldDate\" >= NOW() - INTERVAL '90 days' ORDER BY \"soldDate\" DESC LIMIT 5");
    await q('auto_sample', "SELECT year, make, model, engine FROM \"Auto\" LIMIT 5");
    await q('auto_item_join', "SELECT a.year, a.make, a.model, i.title, i.price FROM \"Auto\" a JOIN \"AutoItemCompatibility\" aic ON a.id = aic.\"autoId\" JOIN \"Item\" i ON aic.\"itemId\" = i.id LIMIT 5");
    // Env var check
    const envKeys = ['TRADING_API_TOKEN','TRADING_API_DEV_NAME','TRADING_API_APP_NAME','TRADING_API_CERT_NAME','FINDINGS_APP_NAME','ANTHROPIC_API_KEY'];
    const envCheck = {};
    for (const k of envKeys) envCheck[k] = process.env[k] ? `SET (${process.env[k].length} chars)` : 'NOT SET';
    R.env_check = envCheck;
    await q('sale_by_store', "SELECT store, COUNT(*) as cnt FROM \"YourSale\" GROUP BY store ORDER BY cnt DESC");
    await q('sale_null_store', "SELECT COUNT(*) as no_store FROM \"YourSale\" WHERE store IS NULL");
    await q('sale_date_range_by_store', "SELECT store, MIN(\"soldDate\") as earliest, MAX(\"soldDate\") as latest, COUNT(*) as cnt FROM \"YourSale\" GROUP BY store ORDER BY cnt DESC");
    await q('sale_dupes', "SELECT \"ebayItemId\", \"soldDate\"::date as sold_date, COUNT(*) as dupes FROM \"YourSale\" GROUP BY \"ebayItemId\", \"soldDate\"::date HAVING COUNT(*) > 1 LIMIT 10");
    await q('sale_most_recent', "SELECT id, \"ebayItemId\", title, \"salePrice\", \"soldDate\", store, \"createdAt\" FROM \"YourSale\" ORDER BY \"createdAt\" DESC LIMIT 5");
    await q('honda_2000_with_items', "SELECT a.year, a.make, a.model, COUNT(aic.\"itemId\") as item_count FROM \"Auto\" a JOIN \"AutoItemCompatibility\" aic ON aic.\"autoId\" = a.id WHERE a.make ILIKE '%Honda%' AND a.year::text = '2000' GROUP BY a.year, a.make, a.model ORDER BY a.model");
    await q('honda_2000_auto_only', "SELECT DISTINCT a.model FROM \"Auto\" a WHERE a.make ILIKE '%Honda%' AND a.year::text = '2000' ORDER BY a.model");
    await q('honda_2000_auto_linked', "SELECT DISTINCT a.model FROM \"Auto\" a JOIN \"AutoItemCompatibility\" aic ON aic.\"autoId\" = a.id WHERE a.make ILIKE '%Honda%' AND a.year::text = '2000' ORDER BY a.model");
    await q('aic_columns', "SELECT column_name FROM information_schema.columns WHERE table_name = 'AutoItemCompatibility' ORDER BY column_name");
    await q('honda_civic_camelCase', "SELECT i.title, i.price, i.seller FROM \"Item\" i JOIN \"AutoItemCompatibility\" aic ON aic.\"itemId\" = i.id JOIN \"Auto\" a ON a.id = aic.\"autoId\" WHERE a.make = 'Honda' AND a.model = 'Civic' AND a.year::text = '2000' LIMIT 5");
    await q('honda_civic_any_year', "SELECT a.year, i.title, i.price FROM \"Item\" i JOIN \"AutoItemCompatibility\" aic ON aic.\"itemId\" = i.id JOIN \"Auto\" a ON a.id = aic.\"autoId\" WHERE a.make = 'Honda' AND a.model ILIKE '%Civic%' LIMIT 5");
    await q('honda_civic_count_all_years', "SELECT a.year::text, COUNT(*) as cnt FROM \"Item\" i JOIN \"AutoItemCompatibility\" aic ON aic.\"itemId\" = i.id JOIN \"Auto\" a ON a.id = aic.\"autoId\" WHERE a.make = 'Honda' AND a.model ILIKE '%Civic%' GROUP BY a.year ORDER BY a.year");
    await q('q1_aic_columns', "SELECT column_name FROM information_schema.columns WHERE table_name = 'AutoItemCompatibility' ORDER BY column_name");
    await q('q2_lowercase_2000', "SELECT COUNT(*) as cnt FROM \"Item\" i JOIN \"AutoItemCompatibility\" aic ON aic.\"itemId\" = i.id JOIN \"Auto\" a ON a.id = aic.\"autoId\" WHERE a.make = 'Honda' AND a.model = 'Civic' AND a.year::text = '2000'");
    await q('q3_lowercase_1999', "SELECT COUNT(*) as cnt FROM \"Item\" i JOIN \"AutoItemCompatibility\" aic ON aic.\"itemId\" = i.id JOIN \"Auto\" a ON a.id = aic.\"autoId\" WHERE a.make = 'Honda' AND a.model = 'Civic' AND a.year::text = '1999'");
    await q('q4_lowercase_2001', "SELECT COUNT(*) as cnt FROM \"Item\" i JOIN \"AutoItemCompatibility\" aic ON aic.\"itemId\" = i.id JOIN \"Auto\" a ON a.id = aic.\"autoId\" WHERE a.make = 'Honda' AND a.model = 'Civic' AND a.year::text = '2001'");
    await q('q5_lowercase_range', "SELECT COUNT(*) as cnt FROM \"Item\" i JOIN \"AutoItemCompatibility\" aic ON aic.\"itemId\" = i.id JOIN \"Auto\" a ON a.id = aic.\"autoId\" WHERE a.make = 'Honda' AND a.model = 'Civic' AND a.year::int >= 1999 AND a.year::int <= 2001");
    await q('q6_brute_force_ilike', "SELECT COUNT(*) as cnt FROM \"Item\" WHERE title ILIKE '%Honda%' AND title ILIKE '%Civic%' AND (title ~ '(1996|1997|1998|1999|2000|2001|2002)')");
    await q('q7_original_app_query', "SELECT COUNT(*) as cnt FROM \"Auto\" a JOIN \"AutoItemCompatibility\" aic ON a.id = aic.\"autoId\" JOIN \"Item\" i ON aic.\"itemId\" = i.id WHERE a.year = 2000 AND a.make = 'Honda' AND a.model = 'Civic'");
    await q('q8_year_as_int', "SELECT COUNT(*) as cnt FROM \"Auto\" a JOIN \"AutoItemCompatibility\" aic ON a.id = aic.\"autoId\" JOIN \"Item\" i ON aic.\"itemId\" = i.id WHERE a.year = '2000' AND a.make = 'Honda' AND a.model = 'Civic'");
    await q('q9_auto_civic_exists', "SELECT id, year, make, model, trim, engine FROM \"Auto\" WHERE make = 'Honda' AND model = 'Civic' AND year::text IN ('1999','2000','2001') ORDER BY year");
    await q('q10_aic_for_civic_autos', "SELECT aic.\"autoId\", aic.\"itemId\" FROM \"AutoItemCompatibility\" aic JOIN \"Auto\" a ON a.id = aic.\"autoId\" WHERE a.make = 'Honda' AND a.model = 'Civic' AND a.year::text IN ('1999','2000','2001') LIMIT 10");
    await q('yard_vehicle_engine_samples', "SELECT engine, engine_type, drivetrain, vin_decoded, COUNT(*) as cnt FROM yard_vehicle WHERE active = true AND engine IS NOT NULL GROUP BY engine, engine_type, drivetrain, vin_decoded ORDER BY cnt DESC LIMIT 15");
    await q('yard_vehicle_decode_status', "SELECT COUNT(*) as total, SUM(CASE WHEN vin_decoded THEN 1 ELSE 0 END) as decoded, SUM(CASE WHEN vin_decoded AND engine IS NOT NULL THEN 1 ELSE 0 END) as has_engine, SUM(CASE WHEN vin IS NOT NULL AND NOT COALESCE(vin_decoded, false) THEN 1 ELSE 0 END) as vin_not_decoded FROM yard_vehicle WHERE active = true");
    await q('market_demand_cache_freshness', "SELECT COUNT(*) as total, COUNT(CASE WHEN last_updated >= NOW() - INTERVAL '7 days' THEN 1 END) as last_7d, COUNT(CASE WHEN last_updated >= NOW() - INTERVAL '30 days' THEN 1 END) as last_30d, MIN(last_updated) as oldest, MAX(last_updated) as newest FROM market_demand_cache");
    res.json(R);
  } catch(e) { res.status(500).json({error: e.message, stack: e.stack}); }
});


  // Have Node serve the files for our built React app
  app.use(express.static(path.resolve(__dirname, '../client/build')));
  // All other GET requests not handled before will return our React app
  app.get('/*', (req, res) => {
    res.sendFile(path.resolve(__dirname, '../client/build', 'index.html'));
  });


async function start() {
  try {
    log.level('debug');

    Model.knex(database);

    log.info(`Running as process: ${process.env.NODE_ENV}`);

    log.debug('running latest database migrations');
    try {
      await database.migrate.latest(database.client.config.migration);
      log.info('Migrations complete');
    } catch (migrationErr) {
      log.error({ err: migrationErr }, 'Migration failed — server will start anyway');
    }

    app.listen(PORT, function () {
      log.info(`Server started at port ${PORT}`);
    });

    if (process.env.RUN_JOB_NOW === '1') {
      log.info('! server started with direct instructions to scrape immediately !');
      const cronWorker = new CronWorkRunner();
      cronWorker.work();
    }

    // app.use(authMiddleware());

    const ebaySellerProcessingJob = schedule.scheduleJob('0 */6 * * *', function (scheduledTime) {
      log.info({ scheduledTime }, `Starting cron route RIGHT NOW, ${scheduledTime}`);
      const cronWorker = new CronWorkRunner();
      cronWorker.work();
    });

    // Price check cron - runs once a week (Sunday at 2:00 AM)
    const priceCheckJob = schedule.scheduleJob('0 2 * * 0', async function (scheduledTime) {
      log.info({ scheduledTime }, 'Starting weekly price check cron');
      const priceCheckRunner = new PriceCheckCronRunner();
      await priceCheckRunner.work({ batchSize: 15 });
    });

    // Market demand cache - runs nightly at 3:00 AM after LKQ scrape
    const MarketDemandCronRunner = require('./lib/MarketDemandCronRunner');
    const marketDemandJob = schedule.scheduleJob('0 3 * * *', async function (scheduledTime) {
      log.info({ scheduledTime }, 'Starting nightly market demand cache update');
      try {
        const runner = new MarketDemandCronRunner();
        await runner.work();
      } catch (err) {
        log.error({ err }, 'Market demand cache update failed');
      }
    });

    // Stale inventory automation - runs weekly Wednesday at 3:00 AM
    const StaleInventoryService = require('./services/StaleInventoryService');
    const staleInventoryJob = schedule.scheduleJob('0 3 * * 3', async function (scheduledTime) {
      log.info({ scheduledTime }, 'Starting weekly stale inventory automation');
      try {
        const service = new StaleInventoryService();
        const result = await service.runAutomation();
        log.info({ result }, 'Stale inventory automation complete');
      } catch (err) {
        log.error({ err }, 'Stale inventory automation failed');
      }
    });

    // Dead inventory scan - runs weekly Monday at 4:00 AM
    const DeadInventoryService = require('./services/DeadInventoryService');
    const deadInventoryJob = schedule.scheduleJob('0 4 * * 1', async function (scheduledTime) {
      log.info({ scheduledTime }, 'Starting weekly dead inventory scan');
      try {
        const service = new DeadInventoryService();
        await service.scanAndLog();
      } catch (err) {
        log.error({ err }, 'Dead inventory scan failed');
      }
    });

    // Restock scan - runs weekly Tuesday at 4:00 AM
    const RestockService = require('./services/RestockService');
    const restockJob = schedule.scheduleJob('0 4 * * 2', async function (scheduledTime) {
      log.info({ scheduledTime }, 'Starting weekly restock scan');
      try {
        const service = new RestockService();
        await service.scanAndFlag();
      } catch (err) {
        log.error({ err }, 'Restock scan failed');
      }
    });

    // Competitor monitoring - runs weekly Thursday at 4:00 AM
    const CompetitorMonitorService = require('./services/CompetitorMonitorService');
    const competitorJob = schedule.scheduleJob('0 4 * * 4', async function (scheduledTime) {
      log.info({ scheduledTime }, 'Starting weekly competitor monitoring');
      try {
        const service = new CompetitorMonitorService();
        await service.scan();
      } catch (err) {
        log.error({ err }, 'Competitor monitoring failed');
      }
    });

    // LKQ scrape cron - runs every night at 2:00 AM (spec section 4.3)
    const LKQScraper = require('./scrapers/LKQScraper');
    const lkqScrapeJob = schedule.scheduleJob('0 2 * * *', async function (scheduledTime) {
      log.info({ scheduledTime }, 'Starting nightly LKQ scrape');
      try {
        const scraper = new LKQScraper();
        const results = await scraper.scrapeAll();
        log.info({ results }, 'Nightly LKQ scrape complete');
      } catch (err) {
        log.error({ err }, 'Nightly LKQ scrape failed');
      }
    });

  } catch (err) {
    log.error({ err }, 'Unable to start server')
  }
}

// istanbul ignore next
if (require.main === module) {
  start();
}