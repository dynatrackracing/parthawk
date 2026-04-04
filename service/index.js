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
const compression = require('compression');
const PORT = process.env.PORT || 9000;
app.use(compression()); // gzip all responses — critical for mobile
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(cors());

// Auth gate — password protection for all DarkHawk pages and APIs
const { authGate } = require('./middleware/authGate');
app.use(authGate);
app.use('/auth', require('./routes/auth'));
app.get('/login', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'login.html'));
});

app.get('/api/health-check', (req, res) => res.json({ ok: true, time: new Date(), env: process.env.NODE_ENV }));

// Debug: test market cache lookup for a specific key
app.get('/api/debug/market-cache', async (req, res) => {
  const { key, pn } = req.query;
  try {
    const { getCachedPrice, buildSearchQuery } = require('./services/MarketPricingService');
    const { extractPartNumbers } = require('./utils/partIntelligence');

    const results = {};

    // If PN provided, extract and look up
    if (pn) {
      const pns = extractPartNumbers(pn);
      results.extractedPNs = pns;
      if (pns.length > 0) {
        const sq = buildSearchQuery({ title: pn });
        results.searchQuery = sq;
        results.cached = await getCachedPrice(sq.cacheKey);
      }
    }

    // If key provided, look up directly
    if (key) {
      results.directLookup = await getCachedPrice(key);
    }

    // Sample from cache (correct column names)
    const sample = await database.raw('SELECT part_number_base, ebay_avg_price, ebay_sold_90d, last_updated FROM market_demand_cache ORDER BY last_updated DESC LIMIT 10');
    results.cacheSample = sample.rows;

    // Total counts
    const counts = await database.raw('SELECT COUNT(*) as total, COUNT(CASE WHEN ebay_avg_price > 0 THEN 1 END) as with_price FROM market_demand_cache');
    results.cacheStats = counts.rows[0];

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
app.use('/restock-want-list', require('./routes/restock-want-list'));
app.use('/scout-alerts', require('./routes/scout-alerts'));
app.use('/opportunities', require('./routes/opportunities'));
app.use('/api/fitment', require('./routes/fitment'));
app.use('/api/listing-tool', require('./routes/listing-tool'));
app.get('/admin/opportunities', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'opportunities.html'));
});
app.get('/admin/restock', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'restock.html'));
});
app.get('/admin/restock-list', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'restock-list.html'));
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
app.use('/autolumen', require('./routes/autolumen'));
app.use('/cache', require('./routes/cache'));
app.use('/trim-intelligence', require('./routes/trim-intelligence'));
app.use('/ebay-messaging', require('./routes/ebay-messaging'));
// Serve static admin tools with cache headers
app.use('/admin', express.static(path.resolve(__dirname, 'public'), {
  maxAge: '10m',  // Cache static files for 10 minutes
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.png') || filePath.endsWith('.jpg') || filePath.endsWith('.svg')) {
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Images: 24h
    }
  }
}));
app.get('/admin/home', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'home.html'));
});
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
app.get('/admin/hunters-perch', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'hunters-perch.html'));
});
app.get('/admin/phoenix', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'phoenix.html'));
});
app.get('/admin/the-cache', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'cache.html'));
});
app.get('/admin/the-mark', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'the-mark.html'));
});
app.get('/admin/velocity', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'velocity.html'));
});
app.get('/admin/instincts', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'instincts.html'));
});
app.get('/admin/prey-cycle', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'prey-cycle.html'));
});
app.get('/admin/carcass', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'stale-inventory.html'));
});
app.get('/admin/scout-alerts', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'scout-alerts.html'));
});
app.get('/admin/alerts', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'alerts.html'));
});
app.get('/admin/sales', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'sales.html'));
});
app.get('/admin/competitors', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'competitors.html'));
});
app.get('/admin/test', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'test.html'));
});
app.get('/admin/listing-tool', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'listing-tool.html'));
});
app.get('/admin/listing-tool-v2', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'listing-tool-v2.html'));
});
app.get('/admin/flyway', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'flyway.html'));
});
// private routes for admin only
app.use('/private', require('./routes/private'));
app.get('/test', (req, res) => {
  res.json('haribol');
});


// Market pricing batch trigger — kicks off full pricing pass in background
app.post('/api/market-price/run-batch', async (req, res) => {
  res.json({ started: true, message: 'Pricing pass started in background. Check /api/debug/full for market_demand_cache freshness.' });
  try {
    const { runPricingPass } = require('./services/MarketPricingService');
    const result = await runPricingPass();
    log.info({ result }, '[MarketPricing] Manual batch complete');
  } catch (err) {
    log.error({ err: err.message }, '[MarketPricing] Manual batch failed');
  }
});

// Market pricing test route — scrapes eBay sold comps for a single query
app.get('/api/market-price', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Provide ?q=searchquery or ?q=68163904AC' });
  try {
    const { singlePriceCheck } = require('./services/MarketPricingService');
    const result = await singlePriceCheck(q);
    res.json({ success: true, ...result });
  } catch (err) {
    log.error({ err, query: q }, 'Market price check failed');
    res.status(500).json({ error: err.message, stack: err.stack });
  }
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

// Seed Florida yards if they don't exist
app.post('/api/admin/seed-florida', async (req, res) => {
  const { database } = require('./database/database');
  const results = [];
  const yards = [
    { name: 'LKQ Tampa', chain: 'LKQ', scrape_method: 'html', visit_frequency: 'road_trip', distance_from_base: 600, enabled: true, flagged: false },
    { name: 'LKQ Largo', chain: 'LKQ', scrape_method: 'html', visit_frequency: 'road_trip', distance_from_base: 610, enabled: true, flagged: false },
    { name: 'LKQ Clearwater', chain: 'LKQ', scrape_method: 'html', visit_frequency: 'road_trip', distance_from_base: 615, enabled: true, flagged: false },
  ];
  for (const yard of yards) {
    try {
      const exists = await database('yard').where('name', yard.name).first();
      if (exists) { results.push({ name: yard.name, status: 'exists', id: exists.id }); continue; }
      const inserted = await database('yard').insert({ id: database.raw('gen_random_uuid()'), ...yard, createdAt: new Date(), updatedAt: new Date() }).returning('id');
      results.push({ name: yard.name, status: 'created', id: inserted[0]?.id || inserted[0] });
    } catch (e) { results.push({ name: yard.name, status: 'error', error: e.message }); }
  }
  res.json({ success: true, results });
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
    await q('sale_non_csv_count', "SELECT COUNT(*) as cnt FROM \"YourSale\" WHERE \"createdAt\"::text NOT LIKE '2026-03-18T23:1%' AND \"createdAt\"::text NOT LIKE '2026-03-18T23:2%'");
    await q('sale_csv_count', "SELECT COUNT(*) as cnt FROM \"YourSale\" WHERE \"createdAt\"::text LIKE '2026-03-18T23:1%' OR \"createdAt\"::text LIKE '2026-03-18T23:2%'");
    await q('sale_non_csv_date_range', "SELECT MIN(\"soldDate\") as earliest, MAX(\"soldDate\") as latest, COUNT(*) as cnt FROM \"YourSale\" WHERE \"createdAt\"::text NOT LIKE '2026-03-18T23:1%' AND \"createdAt\"::text NOT LIKE '2026-03-18T23:2%'");
    await q('sale_created_at_groups', "SELECT \"createdAt\"::date as created_date, COUNT(*) as cnt FROM \"YourSale\" GROUP BY \"createdAt\"::date ORDER BY created_date DESC LIMIT 10");
    await q('sale_overlap_count', "SELECT COUNT(*) as overlap FROM \"YourSale\" a WHERE (a.\"createdAt\"::text LIKE '2026-03-18T23:1%' OR a.\"createdAt\"::text LIKE '2026-03-18T23:2%') AND EXISTS (SELECT 1 FROM \"YourSale\" b WHERE b.\"createdAt\"::text NOT LIKE '2026-03-18T23:1%' AND b.\"createdAt\"::text NOT LIKE '2026-03-18T23:2%' AND b.\"ebayItemId\" = a.\"ebayItemId\")");
    await q('all_public_tables', "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
    await q('sale_like_tables', "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND (tablename ILIKE '%sale%' OR tablename ILIKE '%order%' OR tablename ILIKE '%sold%' OR tablename ILIKE '%transaction%')");
    await q('yoursale_latest_created', "SELECT MAX(\"createdAt\") as latest_created, MAX(\"soldDate\") as latest_sold FROM \"YourSale\"");
    await q('yard_vehicle_by_yard', "SELECT y.name, COUNT(yv.id) as total, SUM(CASE WHEN yv.active THEN 1 ELSE 0 END) as active, MAX(yv.scraped_at) as last_scraped FROM yard y LEFT JOIN yard_vehicle yv ON y.id = yv.yard_id WHERE y.enabled = true GROUP BY y.name ORDER BY y.name");
    await q('yard_status', "SELECT id, name, enabled, last_scraped, flagged, flag_reason FROM yard WHERE chain = 'LKQ' ORDER BY name");
    await q('yard_vehicle_by_yard_id', "SELECT yard_id, COUNT(*) as total, SUM(CASE WHEN active THEN 1 ELSE 0 END) as active_count, MAX(scraped_at) as last_scraped FROM yard_vehicle GROUP BY yard_id ORDER BY total DESC");
    await q('attack_list_yards', "SELECT id, name, enabled, flagged FROM yard WHERE enabled = true AND (flagged = false OR flagged IS NULL) ORDER BY name");
    await q('fl_vehicle_dates', "SELECT y.name, COUNT(*) as total, MIN(yv.date_added) as oldest_date, MAX(yv.date_added) as newest_date, COUNT(CASE WHEN yv.date_added >= NOW() - INTERVAL '7 days' THEN 1 END) as within_7d FROM yard y JOIN yard_vehicle yv ON y.id = yv.yard_id WHERE y.name IN ('LKQ Tampa','LKQ Largo','LKQ Clearwater') AND yv.active = true GROUP BY y.name");
    await q('restock_diag_sales_7d', "SELECT COUNT(*) as cnt FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '7 days'");
    await q('restock_diag_sales_30d', "SELECT COUNT(*) as cnt FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '30 days'");
    await q('restock_diag_recent_sales', "SELECT title, \"salePrice\", \"soldDate\", sku FROM \"YourSale\" WHERE \"soldDate\" IS NOT NULL ORDER BY \"soldDate\" DESC LIMIT 10");
    await q('restock_diag_active_listings', "SELECT COUNT(*) as cnt FROM \"YourListing\" WHERE \"listingStatus\" = 'Active'");
    await q('restock_diag_sku_sample', "SELECT sku, title, \"salePrice\", \"soldDate\" FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '7 days' AND sku IS NOT NULL AND sku != '' ORDER BY \"soldDate\" DESC LIMIT 10");
    await q('restock_diag_sku_null_pct', "SELECT COUNT(*) as total, COUNT(CASE WHEN sku IS NOT NULL AND sku != '' THEN 1 END) as has_sku, COUNT(CASE WHEN sku IS NULL OR sku = '' THEN 1 END) as no_sku FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '7 days'");
    await q('restock_diag_listing_sku_sample', "SELECT sku, title, \"currentPrice\", \"quantityAvailable\" FROM \"YourListing\" WHERE \"listingStatus\" = 'Active' AND sku IS NOT NULL AND sku != '' LIMIT 5");
    await q('restock_diag_part_base_fn', "SELECT part_number_base('AL3T-15604-BD') as ford, part_number_base('56044691AA') as chrysler, part_number_base('39980-TS8-A0') as honda");
    await q('restock_diag_7d_count', "SELECT COUNT(*) as total_sales FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '7 days'");
    await q('restock_diag_jeep_ecm_stock', "SELECT COUNT(*) as cnt, array_agg(sku) as skus FROM \"YourListing\" WHERE \"listingStatus\" = 'Active' AND (sku ILIKE '%0518731%' OR title ILIKE '%0518731%')");
    await q('restock_diag_model_extract', "SELECT title, SUBSTRING(title FROM '(?:Jeep|Dodge|Ford|Chevrolet|Chevy|Toyota|Honda)\\s+(\\w+(?:\\s+\\w+)?)') as extracted_model FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '7 days' AND title ILIKE '%Jeep%' LIMIT 5");
    await q('restock_diag_grouped_pre_stock', "SELECT make, part_type, base_pn, sold_7d, sample_title FROM (WITH rs AS (SELECT title, \"salePrice\"::numeric as price, CASE WHEN title ILIKE '%Jeep%' THEN 'Jeep' WHEN title ILIKE '%Dodge%' THEN 'Dodge' WHEN title ILIKE '%Ford%' THEN 'Ford' WHEN title ILIKE '%Honda%' THEN 'Honda' WHEN title ILIKE '%Toyota%' THEN 'Toyota' WHEN title ILIKE '%Chevrolet%' OR title ILIKE '%Chevy%' THEN 'Chevrolet' ELSE 'Other' END as make, CASE WHEN title ~* '\\m(ECU|ECM|PCM|engine control)\\M' THEN 'ECM' WHEN title ~* '\\m(ABS|anti.lock)\\M' THEN 'ABS' WHEN title ~* '\\m(BCM|body control)\\M' THEN 'BCM' WHEN title ~* '\\m(TIPM)\\M' THEN 'TIPM' WHEN title ~* '\\m(fuse box|junction|ipdm)\\M' THEN 'Fuse Box' WHEN title ~* '\\m(amplifier|bose|harman)\\M' THEN 'Amplifier' WHEN title ~* '\\m(radio|stereo)\\M' THEN 'Radio' ELSE 'Other' END as part_type, part_number_base(COALESCE((regexp_match(title, '\\m(\\d{8}[A-Z]{2})\\M'))[1], (regexp_match(title, '\\m([A-Z]{1,4}\\d{1,2}[A-Z]-[A-Z0-9]{4,6})\\M'))[1], (regexp_match(title, '\\m(\\d{5}-[A-Z0-9]{2,7})\\M'))[1])) as base_pn FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '7 days' AND title IS NOT NULL AND \"salePrice\"::numeric >= 50) SELECT make, part_type, base_pn, COUNT(*) as sold_7d, (array_agg(title))[1] as sample_title FROM rs WHERE make != 'Other' AND part_type != 'Other' GROUP BY make, part_type, base_pn ORDER BY COUNT(*) DESC LIMIT 20) sub");
    await q('restock_diag_raw_query', "SELECT make, part_type, sold_7d, stock, avg_price, action, sample_title FROM (WITH recent_sales AS (SELECT CASE WHEN title ILIKE '%Toyota%' THEN 'Toyota' WHEN title ILIKE '%Honda%' THEN 'Honda' WHEN title ILIKE '%Ford%' THEN 'Ford' WHEN title ILIKE '%Dodge%' THEN 'Dodge' WHEN title ILIKE '%Chrysler%' THEN 'Chrysler' WHEN title ILIKE '%Jeep%' THEN 'Jeep' WHEN title ILIKE '%Ram%' AND title NOT ILIKE '%Ramcharger%' THEN 'Ram' WHEN title ILIKE '%Chevrolet%' OR title ILIKE '%Chevy%' THEN 'Chevrolet' WHEN title ILIKE '%GMC%' THEN 'GMC' WHEN title ILIKE '%Nissan%' THEN 'Nissan' WHEN title ILIKE '%Hyundai%' THEN 'Hyundai' WHEN title ILIKE '%Kia%' THEN 'Kia' ELSE 'Other' END as make, CASE WHEN title ~* '\\m(TCM|TCU|transmission control)\\M' THEN 'TCM' WHEN title ~* '\\m(BCM|body control)\\M' THEN 'BCM' WHEN title ~* '\\m(ECU|ECM|PCM|engine control|engine computer)\\M' THEN 'ECM' WHEN title ~* '\\m(TIPM)\\M' THEN 'TIPM' WHEN title ~* '\\m(fuse box|junction box|ipdm|relay box)\\M' THEN 'Fuse Box' WHEN title ~* '\\m(ABS|anti.lock|brake pump)\\M' THEN 'ABS' WHEN title ~* '\\m(amplifier|bose|harman|JBL)\\M' THEN 'Amplifier' WHEN title ~* '\\m(radio|stereo|receiver)\\M' THEN 'Radio' WHEN title ~* '\\m(cluster|speedometer|gauge)\\M' THEN 'Cluster' WHEN title ~* '\\m(throttle body)\\M' THEN 'Throttle' ELSE 'Other' END as part_type, title, \"salePrice\"::numeric as price, \"soldDate\" FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '7 days' AND title IS NOT NULL), grouped AS (SELECT make, part_type, COUNT(*) as sold_7d, ROUND(AVG(price),2) as avg_price, (array_agg(title))[1] as sample_title FROM recent_sales WHERE make != 'Other' AND part_type != 'Other' GROUP BY make, part_type), with_stock AS (SELECT g.*, COALESCE((SELECT COUNT(*) FROM \"YourListing\" l WHERE l.\"listingStatus\" = 'Active' AND l.title ILIKE '%' || g.make || '%' AND l.title ~* (CASE g.part_type WHEN 'ECM' THEN '\\m(ECU|ECM|PCM)\\M' WHEN 'ABS' THEN '\\m(ABS|anti.lock)\\M' WHEN 'BCM' THEN '\\m(BCM|body control)\\M' WHEN 'TCM' THEN '\\m(TCM|TCU)\\M' WHEN 'TIPM' THEN '\\m(TIPM)\\M' WHEN 'Fuse Box' THEN '\\m(fuse box|junction|ipdm)\\M' WHEN 'Amplifier' THEN '\\m(amplifier|bose|harman)\\M' WHEN 'Radio' THEN '\\m(radio|stereo|receiver)\\M' WHEN 'Cluster' THEN '\\m(cluster|speedometer|gauge)\\M' WHEN 'Throttle' THEN '\\m(throttle body)\\M' ELSE g.part_type END)), 0) as stock FROM grouped g) SELECT *, CASE WHEN stock = 0 AND avg_price >= 200 THEN 'RESTOCK NOW' WHEN stock = 0 THEN 'OUT OF STOCK' WHEN stock <= 1 AND sold_7d >= 2 THEN 'LOW STOCK' ELSE 'MONITOR' END as action FROM with_stock ORDER BY avg_price DESC) sub WHERE stock <= 1 LIMIT 30");
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


// Instant Research — live eBay market research for a vehicle
app.use('/api/instant-research', require('./routes/instant-research'));

// Market pricing cache status
app.get('/api/market-price/status', async (req, res) => {
  try {
    const result = await database.raw(`
      SELECT COUNT(*) as cached_parts, MAX(last_updated) as last_run
      FROM market_demand_cache
      WHERE last_updated > NOW() - INTERVAL '24 hours'
    `);
    const row = result.rows[0];
    res.json({
      cachedParts: parseInt(row.cached_parts) || 0,
      lastRun: row.last_run || null,
      stale: parseInt(row.cached_parts) === 0,
    });
  } catch (err) {
    res.json({ cachedParts: 0, lastRun: null, stale: true });
  }
});

app.use('/return-intelligence', require('./routes/return-intelligence'));
app.use('/flyway', require('./routes/flyway'));
app.use('/phoenix', require('./routes/phoenix'));

// ═══ SPA CATCH-ALL — MUST BE LAST ═══
// All API routes are registered above this point.
// Static files + SPA fallback below catches everything else.
app.use(express.static(path.resolve(__dirname, '../client/build'), {
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    if (filePath.includes('/static/js/') || filePath.includes('/static/css/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));
app.get('/', (req, res) => res.redirect('/login'));
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

    // Initialize local VIN decoder (pre-loads corgi SQLite database)
    const { getDecoder } = require('./lib/LocalVinDecoder');
    getDecoder().then(() => {
      log.info('Local VIN decoder ready');
    }).catch(err => {
      log.warn({ err: err.message }, 'Local VIN decoder init failed — will retry on first decode');
    });

    // DISABLED: CronWorkRunner used SellerItemManager → FindingsAPI (dead since Feb 2025).
    // Item table (21K records) is permanently frozen. market_demand_cache is the pricing source of truth (see priceResolver.js).
    // if (process.env.RUN_JOB_NOW === '1') {
    //   const cronWorker = new CronWorkRunner();
    //   cronWorker.work();
    // }
    // const ebaySellerProcessingJob = schedule.scheduleJob('0 6 * * *', function (scheduledTime) {
    //   const cronWorker = new CronWorkRunner();
    //   cronWorker.work();
    // });

    // YOUR eBay data sync — orders + listings every 6 hours (offset by 1 hour from competitor cron)
    const YourDataManager = require('./managers/YourDataManager');
    const yourDataSyncJob = schedule.scheduleJob('0 1,7,13,19 * * *', async function (scheduledTime) {
      log.info({ scheduledTime }, 'Starting scheduled eBay YourData sync (orders + listings)');
      try {
        const manager = new YourDataManager();
        const results = await manager.syncAll({ daysBack: 30 });
        log.info({ results, scheduledTime }, 'Completed scheduled eBay YourData sync');
      } catch (err) {
        log.error({ err }, 'Scheduled eBay YourData sync failed');
      }
    });

    // Run an immediate sync on startup if sales data is stale (> 24 hours old)
    (async () => {
      try {
        const staleCheck = await database.raw('SELECT MAX("soldDate") as latest FROM "YourSale"');
        const latest = staleCheck.rows[0]?.latest;
        const hoursOld = latest ? Math.floor((Date.now() - new Date(latest).getTime()) / 3600000) : 999;
        if (hoursOld > 24) {
          log.info({ hoursOld, latestSale: latest }, 'YourSale data is stale — triggering immediate sync');
          const manager = new YourDataManager();
          const results = await manager.syncAll({ daysBack: 30 });
          log.info({ results }, 'Startup YourData sync completed');
        } else {
          log.info({ hoursOld }, 'YourSale data is fresh — skipping startup sync');
        }
      } catch (err) {
        log.warn({ err: err.message }, 'Startup YourData stale check failed (non-fatal)');
      }
    })();

    // Price check cron - runs once a week (Sunday at 2:00 AM)
    const priceCheckJob = schedule.scheduleJob('0 2 * * 0', async function (scheduledTime) {
      log.info({ scheduledTime }, 'Starting weekly price check cron');
      const priceCheckRunner = new PriceCheckCronRunner();
      await priceCheckRunner.work(); // default 35 (was 15)
    });

    // DISABLED: MarketDemandCronRunner used findCompletedItems (Finding API dead since Feb 2025).
    // Market cache now populated by: PriceCheckService (weekly), yard sniper (on-demand), importapart drip (manual).
    // const MarketDemandCronRunner = require('./lib/MarketDemandCronRunner');
    // const marketDemandJob = schedule.scheduleJob('0 3 * * *', async function (scheduledTime) {
    //   const runner = new MarketDemandCronRunner();
    //   await runner.work();
    // });

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

    // Flyway scrape: daily 6am UTC - scrapes Pull-A-Part/Foss/Carolina PNP for active road trips
    const FlywayScrapeRunner = require('./lib/FlywayScrapeRunner');
    const flywayJob = schedule.scheduleJob('0 6 * * *', async function (scheduledTime) {
      log.info({ scheduledTime }, 'Starting Flyway scrape run');
      try {
        const runner = new FlywayScrapeRunner();
        await runner.work();
      } catch (err) {
        log.error({ err }, 'Flyway scrape run failed');
      }
    });

    // VIN decode — runs after each local scrape to decode new vehicles + assign trim tiers
    // 3:00 AM UTC = after 2:00 AM local scrape
    // 8:40 AM UTC = after 8:30 AM local scrape
    const vinDecodeJob3am = schedule.scheduleJob('0 3 * * *', async function () {
      log.info('VIN decode cron: post-2am scrape batch');
      try {
        const VinDecodeService = require('./services/VinDecodeService');
        const service = new VinDecodeService();
        // Loop until all undecoded VINs are processed (200 per batch)
        let total = 0;
        for (let i = 0; i < 30; i++) { // max 30 batches = 6000 VINs
          const result = await service.decodeAllUndecoded();
          total += result.decoded;
          if (result.decoded === 0) break;
        }
        log.info({ totalDecoded: total }, 'VIN decode cron complete');
        // Assign trim tiers for newly decoded vehicles
        const { enrichYard } = require('./services/PostScrapeService');
        const yards = await database('yard').where('enabled', true).select('id', 'name');
        for (const yard of yards) {
          try { await enrichYard(yard.id); } catch (e) { log.warn({ yard: yard.name, err: e.message }, 'Trim tier enrichment failed'); }
        }
        log.info('Post-decode trim tier enrichment complete');
      } catch (err) {
        log.error({ err }, 'VIN decode cron failed');
      }
    });

    const vinDecodeJob840am = schedule.scheduleJob('40 8 * * *', async function () {
      log.info('VIN decode cron: post-8:30am scrape mop-up');
      try {
        const VinDecodeService = require('./services/VinDecodeService');
        const service = new VinDecodeService();
        let total = 0;
        for (let i = 0; i < 10; i++) { // max 10 batches = 2000 VINs
          const result = await service.decodeAllUndecoded();
          total += result.decoded;
          if (result.decoded === 0) break;
        }
        log.info({ totalDecoded: total }, 'VIN decode mop-up complete');
        const { enrichYard } = require('./services/PostScrapeService');
        const yards = await database('yard').where('enabled', true).select('id', 'name');
        for (const yard of yards) {
          try { await enrichYard(yard.id); } catch (e) { log.warn({ yard: yard.name, err: e.message }, 'Trim tier mop-up failed'); }
        }
      } catch (err) {
        log.error({ err }, 'VIN decode mop-up failed');
      }
    });

    // Competitor drip scraping — 4x daily with random 0-45min startup jitter
    // Each run: picks 1 least-recently-scraped seller, scrapes 1-2 pages
    // Replaces old Sunday 8pm blast-all-sellers cron (removed from competitors.js)
    const CompetitorDripRunner = require('./lib/CompetitorDripRunner');

    const dripJob5am = schedule.scheduleJob('0 5 * * *', async function () {
      log.info('Competitor drip cron fired (5am UTC window)');
      try { await CompetitorDripRunner.runDrip(); } catch (err) { log.error({ err: err.message }, 'Drip 5am failed'); }
    });

    const dripJobNoon = schedule.scheduleJob('0 12 * * *', async function () {
      log.info('Competitor drip cron fired (noon UTC window)');
      try { await CompetitorDripRunner.runDrip(); } catch (err) { log.error({ err: err.message }, 'Drip noon failed'); }
    });

    const dripJob6pm = schedule.scheduleJob('0 18 * * *', async function () {
      log.info('Competitor drip cron fired (6pm UTC window)');
      try { await CompetitorDripRunner.runDrip(); } catch (err) { log.error({ err: err.message }, 'Drip 6pm failed'); }
    });

    const dripJobMidnight = schedule.scheduleJob('0 0 * * *', async function () {
      log.info('Competitor drip cron fired (midnight UTC window)');
      try { await CompetitorDripRunner.runDrip(); } catch (err) { log.error({ err: err.message }, 'Drip midnight failed'); }

      // Graduate marks once daily (moved from old Sunday-only cron in competitors.js)
      try {
        const axios = require('axios');
        await axios.post('http://localhost:' + (process.env.PORT || 9000) + '/competitors/mark/graduate');
        log.info('Daily mark graduation complete');
      } catch (err) {
        log.error({ err: err.message }, 'Daily mark graduation failed');
      }
    });

    // eBay Messaging — poll for new orders every 15 minutes, process queue every 2 minutes
    const EbayMessagingService = require('./services/EbayMessagingService');
    const messagingService = new EbayMessagingService();

    const messagingPollJob = schedule.scheduleJob('*/15 * * * *', async function () {
      log.info('Cron: Polling for new orders to message');
      try {
        await messagingService.pollNewOrders();
      } catch (err) {
        log.error({ err }, 'Cron: Order polling failed');
      }
    });

    const messagingProcessJob = schedule.scheduleJob('*/2 * * * *', async function () {
      try {
        await messagingService.processQueue();
      } catch (err) {
        log.error({ err }, 'Cron: Message queue processing failed');
      }
    });

    // Load Auto table models into partMatcher cache, then regenerate scout alerts
    try {
      const { loadModelsFromDB } = require('./utils/partMatcher');
      const { generateAlerts } = require('./services/ScoutAlertService');
      setTimeout(async () => {
        try {
          await loadModelsFromDB();
          const r = await generateAlerts();
          log.info({ alertCount: r.alerts }, 'Scout alerts regenerated on startup');
        } catch (e) {
          log.warn({ err: e.message }, 'Scout alert startup generation failed');
        }
      }, 10000); // delay 10s to let migrations finish
    } catch (e) { /* ignore */ }

    // Auto-complete expired flyway trips
    try {
      const FlywayService = require('./services/FlywayService');
      FlywayService.autoCompleteExpiredTrips()
        .then(count => { if (count > 0) log.info({ count }, 'Flyway: auto-completed expired trips'); })
        .catch(err => log.warn({ err: err.message }, 'Flyway: auto-complete error'));
    } catch (e) { /* ignore */ }

    // LKQ scraping runs locally via Task Scheduler — CloudFlare blocks Railway

  } catch (err) {
    log.error({ err }, 'Unable to start server')
  }
}

// istanbul ignore next
if (require.main === module) {
  start();
}