'use strict';

const { log } = require('./logger');
const { database } = require('../database/database');
const FlywayService = require('../services/FlywayService');
const { enrichYard } = require('../services/PostScrapeService');

class FlywayScrapeRunner {
  constructor() {
    this.log = log.child({ class: 'FlywayScrapeRunner' }, true);
    this.running = false;
  }

  async work() {
    if (this.running) {
      this.log.warn('FlywayScrapeRunner already running, skipping');
      return;
    }

    this.running = true;
    this.log.info('FlywayScrapeRunner starting');

    try {
      // Step 1: Auto-complete expired trips
      const completed = await FlywayService.autoCompleteExpiredTrips();
      if (completed > 0) {
        this.log.info({ completed }, 'Auto-completed expired Flyway trips');
      }

      // Step 2: Cleanup vehicle data for trips past 24-hour grace period
      try {
        const deactivated = await FlywayService.cleanupExpiredTripVehicles();
        if (deactivated > 0) {
          this.log.info({ deactivated }, 'Cleaned up expired trip vehicle data');
        }
      } catch (err) {
        this.log.error({ err: err.message }, 'Flyway cleanup failed (non-fatal)');
      }

      // Step 3: Get active scrapable yards (non-LKQ only)
      const allYards = await FlywayService.getActiveScrapableYards();

      const nonLkqYards = allYards.filter(y => {
        const chain = (y.chain || '').toUpperCase();
        const method = (y.scrape_method || '').toLowerCase();
        return !chain.includes('LKQ') && method !== 'lkq';
      });

      if (nonLkqYards.length === 0) {
        this.log.info('No non-LKQ Flyway yards to scrape');
        this.running = false;
        return;
      }

      // Deduplicate yards (multiple trips might share the same yard)
      const seen = new Set();
      const uniqueYards = nonLkqYards.filter(y => {
        if (seen.has(y.id)) return false;
        seen.add(y.id);
        return true;
      });

      this.log.info({ yardCount: uniqueYards.length }, 'Scraping non-LKQ Flyway yards');

      const results = { success: 0, failed: 0, skipped: 0, newVehicles: 0 };
      const scrapedYardIds = [];

      for (const yard of uniqueYards) {
        try {
          const method = (yard.scrape_method || '').toLowerCase();

          if (method === 'manual' || method === 'none') {
            results.skipped++;
            continue;
          }

          this.log.info({ yard: yard.name, method }, 'Scraping Flyway yard');

          const beforeCount = await database('yard_vehicle')
            .where({ yard_id: yard.id, active: true })
            .count('id as count')
            .first();

          // 5-minute timeout per yard
          await Promise.race([
            this.scrapeYard(yard),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Scrape timeout')), 5 * 60 * 1000)),
          ]);

          const afterCount = await database('yard_vehicle')
            .where({ yard_id: yard.id, active: true })
            .count('id as count')
            .first();

          const newCount = Math.max(0, parseInt(afterCount.count) - parseInt(beforeCount.count));
          results.newVehicles += newCount;
          results.success++;
          scrapedYardIds.push(yard.id);

          await database('yard').where({ id: yard.id }).update({ last_scraped: new Date(), updatedAt: new Date() });
          this.log.info({ yard: yard.name, newVehicles: newCount }, 'Flyway yard scrape complete');

          await new Promise(r => setTimeout(r, 3000));
        } catch (err) {
          this.log.error({ err: err.message, yard: yard.name }, 'Failed to scrape Flyway yard');
          results.failed++;
        }
      }

      // Step 4: Enrich scraped yards (VIN decode + trim tier + scout alerts)
      for (const yardId of scrapedYardIds) {
        try {
          const stats = await enrichYard(yardId);
          this.log.info({ yardId, ...stats }, 'Flyway yard enrichment complete');
        } catch (err) {
          this.log.error({ err: err.message, yardId }, 'Flyway yard enrichment failed (non-fatal)');
        }
      }

      this.log.info(results, 'FlywayScrapeRunner complete');
    } catch (err) {
      this.log.error({ err }, 'FlywayScrapeRunner fatal error');
    } finally {
      this.running = false;
    }
  }

  async scrapeYard(yard) {
    const method = (yard.scrape_method || '').toLowerCase();
    const chain = (yard.chain || '').toLowerCase();

    if (method === 'pullapart' || chain === 'pull-a-part') {
      const PullAPartScraper = require('../scrapers/PullAPartScraper');
      const scraper = new PullAPartScraper();
      await scraper.scrapeYard(yard);

    } else if (chain === 'foss') {
      // Skip Foss on Sundays (PriceCheckCronRunner uses Playwright at 2am)
      if (new Date().getUTCDay() === 0) {
        this.log.info({ yard: yard.name }, 'Skipping Foss yard on Sunday (PriceCheck day)');
        return;
      }
      const FossScraper = require('../scrapers/FossScraper');
      const scraper = new FossScraper();
      // FossScraper.scrapeLocation needs a location from this.locations
      const location = scraper.locations.find(l => l.name === yard.name);
      if (location) {
        await scraper.scrapeLocation(location);
      } else {
        this.log.warn({ yard: yard.name }, 'Foss yard not in scraper locations list');
      }

    } else if (chain === 'carolina pnp') {
      // Carolina PNP requires local execution — datacenter IPs are blocked
      if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_NAME) {
        this.log.info({ yard: yard.name }, 'Skipping Carolina PNP — local-only scraper, blocked on Railway');
        return;
      }
      const CarolinaPickNPullScraper = require('../scrapers/CarolinaPickNPullScraper');
      const scraper = new CarolinaPickNPullScraper();
      await scraper.scrapeYard(yard);

    } else if (chain === 'upullandsave' || chain === 'u-pull-and-save') {
      const UPullAndSaveScraper = require('../scrapers/UPullAndSaveScraper');
      const scraper = new UPullAndSaveScraper();
      await scraper.scrapeYard(yard);

    } else if (chain === 'chesterfield') {
      const ChesterfieldScraper = require('../scrapers/ChesterfieldScraper');
      const scraper = new ChesterfieldScraper();
      await scraper.scrapeYard(yard);

    } else if (chain === 'pickapartva' || chain === 'pick-a-part va') {
      const PickAPartVAScraper = require('../scrapers/PickAPartVAScraper');
      const scraper = new PickAPartVAScraper();
      await scraper.scrapeYard(yard);

    } else {
      this.log.warn({ yard: yard.name, method, chain }, 'No scraper available, skipping');
    }
  }
}

module.exports = FlywayScrapeRunner;
