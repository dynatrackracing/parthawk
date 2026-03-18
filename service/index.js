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
app.use('/api/parts', require('./routes/parts'));
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
// private routes for admin only
app.use('/private', require('./routes/private'));
app.get('/test', (req, res) => {
  res.json('haribol');
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