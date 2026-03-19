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

// Data verification — confirms table access matches original app
app.get('/api/debug/verify-tables', async (req, res) => {
  try {
    const { database } = require('./database/database');
    const results = {};

    // YourSale: count total and last 180 days
    try {
      const total = await database('YourSale').count('* as cnt').first();
      const cutoff = new Date(Date.now() - 180 * 86400000);
      const recent = await database('YourSale').where('soldDate', '>=', cutoff).count('* as cnt').first();
      const sample = await database('YourSale').orderBy('soldDate', 'desc').select('title', 'salePrice', 'soldDate', 'sku').limit(3);
      results.YourSale = { total: parseInt(total?.cnt || 0), last180d: parseInt(recent?.cnt || 0), sample };
    } catch (e) { results.YourSale = { error: e.message }; }

    // YourListing: count total and active
    try {
      const total = await database('YourListing').count('* as cnt').first();
      const active = await database('YourListing').where('listingStatus', 'Active').count('* as cnt').first();
      const sample = await database('YourListing').where('listingStatus', 'Active').select('title', 'currentPrice', 'sku', 'quantityAvailable', 'listingStatus').limit(3);
      results.YourListing = { total: parseInt(total?.cnt || 0), active: parseInt(active?.cnt || 0), sample };
    } catch (e) { results.YourListing = { error: e.message }; }

    // Column verification — show actual columns
    try {
      const saleCols = await database.raw("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'YourSale' ORDER BY ordinal_position");
      results.YourSaleColumns = (saleCols.rows || saleCols).map(r => `${r.column_name} (${r.data_type})`);
    } catch (e) { results.YourSaleColumns = { error: e.message }; }

    try {
      const listCols = await database.raw("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'YourListing' ORDER BY ordinal_position");
      results.YourListingColumns = (listCols.rows || listCols).map(r => `${r.column_name} (${r.data_type})`);
    } catch (e) { results.YourListingColumns = { error: e.message }; }

    // Auto + AutoItemCompatibility counts
    try {
      const ac = await database('Auto').count('* as cnt').first();
      const aic = await database('AutoItemCompatibility').count('* as cnt').first();
      const itemC = await database('Item').count('* as cnt').first();
      results.Auto = parseInt(ac?.cnt || 0);
      results.AutoItemCompatibility = parseInt(aic?.cnt || 0);
      results.Item = parseInt(itemC?.cnt || 0);
    } catch (e) { results.AutoItemError = e.message; }

    // Yard vehicle counts
    try {
      const yv = await database('yard_vehicle').where('active', true).count('* as cnt').first();
      results.activeYardVehicles = parseInt(yv?.cnt || 0);
    } catch (e) { results.yardVehicleError = e.message; }

    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// TEMPORARY debug endpoint — remove after use
app.get('/api/debug/makes', async (req, res) => {
  try {
    const { database } = require('./database/database');

    const tables = [
      'Auto', 'AutoItemCompatibility', 'Item', 'InterchangeNumber',
      'ItemInterchangeNumber', 'Competitor', 'CompetitorListing',
      'YourSale', 'YourListing', 'SoldItem', 'SoldItemSeller',
      'yard', 'yard_vehicle', 'yard_visit_feedback',
      'pull_session', 'vin_cache', 'trim_intelligence',
      'part_location', 'dead_inventory', 'market_demand_cache',
      'PriceCheck', 'PriceSnapshot', 'MarketResearchRun',
      'Cron', 'Users',
      'stale_inventory_action', 'return_intake', 'restock_flag', 'competitor_alert',
    ];

    const counts = {};
    for (const t of tables) {
      try {
        const r = await database(t).count('* as cnt').first();
        counts[t] = parseInt(r?.cnt || 0);
      } catch (e) {
        counts[t] = 0;
      }
    }

    // Check if specific order exists
    let orderCheck = null;
    try {
      orderCheck = await database('YourSale')
        .where('ebayOrderId', '18-14345-57629-286936703557').first();
    } catch (e) { orderCheck = { error: e.message }; }

    // Sample: Dodge Ram sales
    let dodgeRamSales = [];
    try {
      dodgeRamSales = await database('YourSale')
        .whereRaw('title ILIKE ?', ['%Dodge%'])
        .whereRaw('title ILIKE ?', ['%Ram%'])
        .select('title', 'salePrice', 'soldDate')
        .limit(10);
    } catch (e) { dodgeRamSales = [{ error: e.message }]; }

    // Distinct makes from yard_vehicle
    let yardMakes = [];
    try {
      yardMakes = (await database('yard_vehicle').distinct('make').orderBy('make')).map(r => r.make);
    } catch (e) {}

    // Sample YourSale titles
    let saleSamples = [];
    try {
      saleSamples = await database('YourSale')
        .select('title', 'salePrice', 'soldDate', 'sku')
        .orderBy('soldDate', 'desc').limit(5);
    } catch (e) {}

    res.json({
      table_counts: counts,
      order_18_14345_exists: orderCheck ? true : false,
      order_18_14345_data: orderCheck,
      dodge_ram_sales: dodgeRamSales,
      yard_vehicle_makes: yardMakes,
      recent_sale_samples: saleSamples,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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