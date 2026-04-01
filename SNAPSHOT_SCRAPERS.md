# DARKHAWK SCRAPERS & CRONS — 2026-04-01

## FILE: service/lib/CompetitorDripRunner.js
```javascript
'use strict';

const { log } = require('./logger');
const { database } = require('../database/database');
const SoldItemsManager = require('../managers/SoldItemsManager');

/**
 * CompetitorDripRunner — Randomized micro-scrape runner.
 *
 * Called 4x daily (6am, noon, 6pm, midnight UTC) from index.js crons.
 * Each run: random 0-45min startup delay, picks the least-recently-scraped
 * enabled seller, scrapes 1-2 random pages, cleans up the browser.
 *
 * Replaces the old Sunday 8pm "blast all sellers at once" cron that risked
 * eBay rate-limiting and Playwright OOM on Railway.
 */
class CompetitorDripRunner {
  constructor() {
    this.log = log.child({ class: 'CompetitorDripRunner' }, true);
  }

  async runDrip() {
    // Random delay 0-45 minutes so execution time varies daily
    const delayMs = Math.floor(Math.random() * 45 * 60 * 1000);
    const delayMin = Math.round(delayMs / 60000);
    this.log.info({ delayMinutes: delayMin }, 'Drip scrape scheduled, waiting random delay');

    await new Promise(resolve => setTimeout(resolve, delayMs));

    // Pick the seller least recently scraped
    const seller = await database('SoldItemSeller')
      .where('enabled', true)
      .orderByRaw('"lastScrapedAt" ASC NULLS FIRST')
      .first();

    if (!seller) {
      this.log.info('No enabled sellers found, skipping drip');
      return { skipped: true, reason: 'no enabled sellers' };
    }

    // Skip if this seller was scraped within the last 6 hours
    if (seller.lastScrapedAt && (Date.now() - new Date(seller.lastScrapedAt).getTime()) < 6 * 60 * 60 * 1000) {
      this.log.info({ seller: seller.name, lastScraped: seller.lastScrapedAt }, 'All sellers recently scraped, skipping');
      return { skipped: true, reason: 'all sellers fresh', seller: seller.name };
    }

    const maxPages = 1 + Math.floor(Math.random() * 2); // 1 or 2 pages
    this.log.info({ seller: seller.name, maxPages, delayMinutes: delayMin }, 'Starting drip scrape');

    const manager = new SoldItemsManager();
    try {
      const result = await manager.scrapeCompetitor({
        seller: seller.name,
        categoryId: '6030',
        maxPages,
      });

      // Update seller stats
      await database('SoldItemSeller').where('name', seller.name).update({
        lastScrapedAt: new Date(),
        itemsScraped: (seller.itemsScraped || 0) + (result.stored || 0),
        updatedAt: new Date(),
      });

      this.log.info({ seller: seller.name, maxPages, stored: result.stored, scraped: result.scraped }, 'Drip scrape complete');
      return { seller: seller.name, maxPages, ...result };
    } catch (err) {
      this.log.error({ err: err.message, seller: seller.name }, 'Drip scrape failed');
      return { seller: seller.name, error: err.message };
    } finally {
      try { await manager.scraper.closeBrowser(); } catch (e) {}
    }
  }
}

module.exports = new CompetitorDripRunner();
```
---
## FILE: service/lib/FlywayScrapeRunner.js
```javascript
'use strict';

const axios = require('axios');
const { log } = require('./logger');
const { database } = require('../database/database');
const FlywayService = require('../services/FlywayService');
const TrimTierService = require('../services/TrimTierService');
const { getTrimTier } = require('../config/trim-tier-config');

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

      // Step 3: VIN decode new vehicles
      if (scrapedYardIds.length > 0) {
        await this.decodeNewVehicles(scrapedYardIds);
        await this.assignTrimTiers(scrapedYardIds);
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
      const CarolinaPickNPullScraper = require('../scrapers/CarolinaPickNPullScraper');
      const scraper = new CarolinaPickNPullScraper();
      await scraper.scrapeYard(yard);

    } else {
      this.log.warn({ yard: yard.name, method, chain }, 'No scraper available, skipping');
    }
  }

  /**
   * NHTSA VIN decode for new vehicles.
   * Replicates the logic from decode-yard-vins.js inline.
   */
  async decodeNewVehicles(yardIds) {
    try {
      const undecoded = await database('yard_vehicle')
        .whereIn('yard_id', yardIds)
        .where('active', true)
        .whereNotNull('vin')
        .whereRaw("LENGTH(vin) = 17")
        .where(function () {
          this.whereNull('vin_decoded_at');
        })
        .select('id', 'vin', 'year', 'make', 'model')
        .limit(500);

      if (undecoded.length === 0) {
        this.log.info('No vehicles need VIN decoding');
        return;
      }

      this.log.info({ count: undecoded.length }, 'Decoding VINs for Flyway vehicles');
      let decoded = 0, cached = 0, errors = 0;

      for (let i = 0; i < undecoded.length; i += 50) {
        const batch = undecoded.slice(i, i + 50);

        // Check vin_cache first
        for (const row of batch) {
          try {
            const c = await database('vin_cache').where('vin', row.vin.toUpperCase()).first();
            if (c) {
              await database('yard_vehicle').where('id', row.id).update({
                engine: c.engine ? c.engine.substring(0, 50) : null,
                drivetrain: c.drivetrain ? c.drivetrain.substring(0, 20) : null,
                trim_level: c.trim ? c.trim.substring(0, 100) : null,
                body_style: c.body_style ? c.body_style.substring(0, 50) : null,
                vin_decoded_at: new Date(),
                updatedAt: new Date(),
              });
              cached++;
              continue;
            }
          } catch (e) { /* cache miss */ }

          // NHTSA single decode (batch endpoint sometimes unreliable for small sets)
          try {
            const res = await axios.get(
              `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${row.vin.toUpperCase()}?format=json`,
              { timeout: 10000 }
            );
            const results = res.data?.Results || [];
            const get = (id) => {
              const r = results.find(x => x.VariableId === id);
              const val = r?.Value?.trim();
              return (val && val !== '' && val !== 'Not Applicable') ? val : null;
            };

            const disp = get(13);
            const rawCyl = get(71);
            let engine = null;
            if (disp) {
              const dn = parseFloat(disp);
              engine = (!isNaN(dn) ? dn.toFixed(1) : disp) + 'L';
              const c = parseInt(rawCyl);
              if (c >= 2 && c <= 16) {
                const lb = c <= 4 ? '4-cyl' : c === 5 ? '5-cyl' : c === 6 ? 'V6' : c === 8 ? 'V8' : c === 10 ? 'V10' : c + '-cyl';
                engine += ' ' + lb;
              }
            }

            const ft = (get(24) || '').toLowerCase();
            let engineType = 'Gas';
            if (ft.includes('diesel')) engineType = 'Diesel';
            else if (ft.includes('hybrid')) engineType = 'Hybrid';
            else if (ft.includes('electric') && !ft.includes('hybrid')) engineType = 'Electric';

            const dt = (get(15) || '').toUpperCase();
            let drivetrain = null;
            if (dt.includes('4WD') || dt.includes('4X4') || dt.includes('4-WHEEL')) drivetrain = '4WD';
            else if (dt.includes('AWD') || dt.includes('ALL-WHEEL') || dt.includes('ALL WHEEL')) drivetrain = 'AWD';
            else if (dt.includes('FWD') || dt.includes('FRONT-WHEEL') || dt.includes('FRONT WHEEL')) drivetrain = 'FWD';
            else if (dt.includes('RWD') || dt.includes('REAR-WHEEL') || dt.includes('REAR WHEEL')) drivetrain = 'RWD';

            const trim = get(38);
            const bodyStyle = get(5);

            // Cache the result
            try {
              await database('vin_cache').insert({
                vin: row.vin.toUpperCase(),
                year: get(29) ? parseInt(get(29)) : null,
                make: get(26), model: get(28),
                trim, engine, drivetrain, body_style: bodyStyle,
                raw_nhtsa: JSON.stringify(results),
                decoded_at: new Date(), createdAt: new Date(),
              }).onConflict('vin').ignore();
            } catch (e) { /* cache insert failed, continue */ }

            const upd = { vin_decoded_at: new Date(), updatedAt: new Date() };
            if (engine) upd.engine = engine.substring(0, 50);
            if (engineType) upd.engine_type = engineType.substring(0, 20);
            if (drivetrain) upd.drivetrain = drivetrain.substring(0, 20);
            if (trim) upd.trim_level = trim.substring(0, 100);
            if (bodyStyle) upd.body_style = bodyStyle.substring(0, 50);
            await database('yard_vehicle').where('id', row.id).update(upd);
            decoded++;

            await new Promise(r => setTimeout(r, 200));
          } catch (e) {
            errors++;
          }
        }
      }

      this.log.info({ decoded, cached, errors }, 'VIN decode complete');
    } catch (err) {
      this.log.error({ err: err.message }, 'VIN decode step failed (non-fatal)');
    }
  }

  /**
   * Assign trim tiers to decoded vehicles that lack them.
   */
  async assignTrimTiers(yardIds) {
    try {
      const untiered = await database('yard_vehicle')
        .whereIn('yard_id', yardIds)
        .where('active', true)
        .whereNull('trim_tier')
        .whereNotNull('make')
        .whereNotNull('model')
        .select('id', 'year', 'make', 'model', 'engine', 'trim_level', 'decoded_trim',
                'decoded_engine', 'decoded_drivetrain', 'decoded_transmission', 'drivetrain')
        .limit(500);

      if (untiered.length === 0) {
        this.log.info('No vehicles need trim tier assignment');
        return;
      }

      this.log.info({ count: untiered.length }, 'Assigning trim tiers to Flyway vehicles');
      let assigned = 0;

      for (const v of untiered) {
        try {
          const year = parseInt(v.year) || 0;
          const make = titleCase(v.make);
          const model = titleCase(v.model);
          const trimName = v.decoded_trim || v.trim_level || null;
          const engine = v.decoded_engine || v.engine || null;
          const transmission = v.decoded_transmission || null;
          const dt = v.decoded_drivetrain || v.drivetrain || null;

          // Tier 1: trim_tier_reference via TrimTierService
          let tierResult = null;
          try {
            tierResult = await TrimTierService.lookup(year, make, model, trimName, engine, transmission, dt);
          } catch (e) { /* lookup failed */ }

          // Tier 2: static config fallback
          if (!tierResult && trimName) {
            const staticResult = getTrimTier(make, trimName);
            if (staticResult) {
              tierResult = { tierString: staticResult.tier, audioBrand: null, expectedParts: null, cult: false };
            }
          }

          if (tierResult) {
            const upd = { trim_tier: tierResult.tierString, updatedAt: new Date() };
            if (tierResult.audioBrand) upd.audio_brand = tierResult.audioBrand;
            if (tierResult.expectedParts) upd.expected_parts = tierResult.expectedParts;
            if (tierResult.cult) upd.cult = true;
            await database('yard_vehicle').where('id', v.id).update(upd);
            assigned++;
          }
        } catch (e) { /* skip individual failures */ }
      }

      this.log.info({ assigned, total: untiered.length }, 'Trim tier assignment complete');
    } catch (err) {
      this.log.error({ err: err.message }, 'Trim tier assignment failed (non-fatal)');
    }
  }
}

function titleCase(str) {
  if (!str) return str;
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

module.exports = FlywayScrapeRunner;
```
---
## FILE: service/lib/PriceCheckCronRunner.js
```javascript
'use strict';

const { log } = require('./logger');
const PriceCheckService = require('../services/PriceCheckService');
const PriceCheck = require('../models/PriceCheck');
const YourListing = require('../models/YourListing');
const AsyncLock = require('async-lock');
const { v4: uuidv4 } = require('uuid');

const lock = new AsyncLock({ maxPending: 0, timeout: 1000 });

class PriceCheckCronRunner {
  constructor() {
    this.log = log.child({ class: 'PriceCheckCronRunner' }, true);
    this.lock = lock;
  }

  async work({ batchSize = 15 } = {}) {
    const key = 'priceCheckCron';

    if (this.lock.isBusy(key)) {
      this.log.debug('Price check cron is still running!');
      return;
    }

    try {
      await this.lock.acquire(key, async () => {
        this.log.info({ batchSize }, 'Lock acquired, starting price check cron');
        await this.doWork(batchSize);
      });
    } catch (err) {
      if (err.message === 'async-lock timed out' || err.message === 'Too much pending tasks') {
        this.log.warn(err, `Unable to acquire lock key ${key}, price check cron is already running`);
      } else {
        this.log.error(err, 'Unexpected error occurred during price check cron');
      }
    }
  }

  async doWork(batchSize) {
    const startTime = Date.now();

    // Get listings that need price checks
    const listings = await this.getListingsNeedingPriceCheck(batchSize);

    if (listings.length === 0) {
      this.log.info('No listings need price checks');
      return;
    }

    this.log.info({ count: listings.length }, 'Found listings needing price check');

    let processed = 0;
    let errors = 0;

    for (const listing of listings) {
      try {
        this.log.debug({
          listingId: listing.id,
          title: listing.title?.substring(0, 50)
        }, 'Checking price');

        await PriceCheckService.checkPrice(
          listing.id,
          listing.title,
          parseFloat(listing.currentPrice),
          true // force refresh
        );

        processed++;

        // Random delay between checks (3-6 seconds) to avoid rate limiting
        const delay = 3000 + Math.random() * 3000;
        await this.sleep(delay);

      } catch (err) {
        errors++;
        this.log.error({
          err,
          listingId: listing.id
        }, 'Error checking price for listing');

        // Longer delay after error
        await this.sleep(5000);
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    this.log.info({
      processed,
      errors,
      elapsed,
      batchSize,
    }, 'Price check cron completed');
  }

  /**
   * Get listings that need price checks, prioritized by:
   * 1. Never checked (no PriceCheck record)
   * 2. Most stale (oldest checkedAt)
   *
   * Omitted listings are always excluded.
   * Cache window is 7 days — cron runs weekly so each listing gets checked once per week.
   */
  async getListingsNeedingPriceCheck(limit) {
    const cacheMaxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    const cutoff = new Date(Date.now() - cacheMaxAge);

    // Get IDs of listings with a price check within the last 7 days
    const recentChecks = await PriceCheck.query()
      .select('listingId')
      .where('checkedAt', '>', cutoff)
      .groupBy('listingId');

    const recentlyCheckedIds = recentChecks.map(r => r.listingId);

    // Get active, non-omitted, in-stock listings that haven't been checked in the last 7 days
    let query = YourListing.query()
      .where('listingStatus', 'Active')
      .where('priceCheckOmitted', false)
      .where('quantityAvailable', '>', 0)
      .orderBy('startTime', 'asc') // Older listings first
      .limit(limit);

    if (recentlyCheckedIds.length > 0) {
      query = query.whereNotIn('id', recentlyCheckedIds);
    }

    return query;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = PriceCheckCronRunner;
```
---
## FILE: service/lib/MarketDemandCronRunner.js
```javascript
'use strict';

const { log } = require('./logger');
const { database } = require('../database/database');
const { normalizePartNumber } = require('./partNumberUtils');
const axios = require('axios');
const xml2js = require('xml2js');

const CACHE_TTL_HOURS = 24;

/**
 * MarketDemandCronRunner - Nightly job to update market_demand_cache
 * for all normalized part numbers in the Item table.
 *
 * Runs at 3am after LKQ scrape at 2am.
 * Uses eBay Finding API findCompletedItems for sold data.
 */
class MarketDemandCronRunner {
  constructor() {
    this.log = log.child({ class: 'MarketDemandCronRunner' }, true);
  }

  async work() {
    this.log.info('Starting market demand cache update');

    let partNumbers;
    try {
      // Get distinct normalized part numbers from Item table
      const rows = await database('Item')
        .whereNotNull('partNumberBase')
        .where('partNumberBase', '!=', '')
        .distinct('partNumberBase')
        .select('partNumberBase');
      partNumbers = rows.map(r => r.partNumberBase);
    } catch (err) {
      this.log.error({ err: err.message }, 'Could not query Item table for part numbers');
      return;
    }

    this.log.info({ count: partNumbers.length }, 'Part numbers to check');

    let updated = 0;
    let skipped = 0;

    for (const pn of partNumbers) {
      // Check if cache is still fresh (< 24h old)
      try {
        const existing = await database('market_demand_cache')
          .where('part_number_base', pn).first();
        if (existing) {
          const age = Date.now() - new Date(existing.last_updated).getTime();
          if (age < CACHE_TTL_HOURS * 60 * 60 * 1000) {
            skipped++;
            continue;
          }
        }
      } catch (e) {
        // Table may not exist yet
      }

      // Query eBay for sold listings
      try {
        const result = await this.queryEbaySold(pn);
        await this.upsertCache(pn, result);
        updated++;
      } catch (err) {
        this.log.warn({ err: err.message, pn }, 'eBay query failed for part number');
      }

      // Rate limit: 100ms between calls to avoid eBay throttling
      await new Promise(r => setTimeout(r, 100));
    }

    this.log.info({ updated, skipped, total: partNumbers.length }, 'Market demand cache update complete');
  }

  /**
   * Query eBay Finding API for completed/sold items matching a part number.
   * Returns { soldCount, avgPrice, activeListings }
   */
  async queryEbaySold(partNumber) {
    const appName = process.env.FINDINGS_APP_NAME;
    if (!appName) {
      // No eBay credentials — return zero data
      return { soldCount: 0, avgPrice: 0, activeListings: 0 };
    }

    const url = 'https://svcs.ebay.com/services/search/FindingService/v1';

    // Query completed items (sold in last 90 days)
    const soldXml = `<?xml version='1.0' encoding='utf-8'?>
      <findCompletedItemsRequest xmlns="http://www.ebay.com/marketplace/search/v1/services">
        <keywords>${escapeXml(partNumber)}</keywords>
        <itemFilter><name>SoldItemsOnly</name><value>true</value></itemFilter>
        <paginationInput><entriesPerPage>50</entriesPerPage><pageNumber>1</pageNumber></paginationInput>
      </findCompletedItemsRequest>`;

    let soldCount = 0;
    let totalPrice = 0;

    try {
      const response = await axios({
        method: 'POST', url, timeout: 15000,
        headers: {
          'X-EBAY-SOA-SERVICE-NAME': 'FindingService',
          'X-EBAY-SOA-OPERATION-NAME': 'findCompletedItems',
          'X-EBAY-SOA-SECURITY-APPNAME': appName,
          'X-EBAY-SOA-GLOBAL-ID': 'EBAY-US',
          'X-EBAY-SOA-REQUEST-DATA-FORMAT': 'XML',
          'X-EBAY-SOA-RESPONSE-DATA-FORMAT': 'XML',
          'Content-Type': 'text/xml',
        },
        data: soldXml,
      });

      const parsed = await xml2js.parseStringPromise(response.data);
      const searchResult = parsed?.findCompletedItemsResponse?.searchResult?.[0];
      const items = searchResult?.item || [];
      soldCount = parseInt(searchResult?.$?.count || items.length);

      for (const item of items) {
        const price = parseFloat(item?.sellingStatus?.[0]?.currentPrice?.[0]?._ || 0);
        totalPrice += price;
      }
    } catch (err) {
      this.log.warn({ err: err.message }, 'findCompletedItems failed');
    }

    const avgPrice = soldCount > 0 ? totalPrice / soldCount : 0;

    // Query active listings count
    let activeListings = 0;
    try {
      const activeXml = `<?xml version='1.0' encoding='utf-8'?>
        <findItemsByKeywordsRequest xmlns="http://www.ebay.com/marketplace/search/v1/services">
          <keywords>${escapeXml(partNumber)}</keywords>
          <paginationInput><entriesPerPage>1</entriesPerPage><pageNumber>1</pageNumber></paginationInput>
        </findItemsByKeywordsRequest>`;

      const response = await axios({
        method: 'POST', url, timeout: 15000,
        headers: {
          'X-EBAY-SOA-SERVICE-NAME': 'FindingService',
          'X-EBAY-SOA-OPERATION-NAME': 'findItemsByKeywords',
          'X-EBAY-SOA-SECURITY-APPNAME': appName,
          'X-EBAY-SOA-GLOBAL-ID': 'EBAY-US',
          'X-EBAY-SOA-REQUEST-DATA-FORMAT': 'XML',
          'X-EBAY-SOA-RESPONSE-DATA-FORMAT': 'XML',
          'Content-Type': 'text/xml',
        },
        data: activeXml,
      });

      const parsed = await xml2js.parseStringPromise(response.data);
      activeListings = parseInt(
        parsed?.findItemsByKeywordsResponse?.paginationOutput?.[0]?.totalEntries?.[0] || 0
      );
    } catch (err) {
      this.log.warn({ err: err.message }, 'findItemsByKeywords failed');
    }

    return { soldCount, avgPrice, activeListings };
  }

  async upsertCache(partNumberBase, { soldCount, avgPrice, activeListings }) {
    // Seasonal weight: recent 30-day sales weighted heavier (spec: Phase 5)
    // Approximate: if 90d count is known, estimate 30d as ~33% unless higher
    const est30d = Math.round(soldCount / 3);
    // Seasonal weight = (30d_rate * 3) / 90d_rate — above 1.0 means trending up
    const seasonalWeight = soldCount > 0 ? Math.round((est30d * 3 / soldCount) * 100) / 100 : 1.0;
    const marketScore = activeListings > 0 ? Math.round((soldCount / activeListings) * 100) / 100 : 0;

    try {
      const existing = await database('market_demand_cache')
        .where('part_number_base', partNumberBase).first();

      const data = {
        ebay_sold_90d: soldCount,
        ebay_avg_price: Math.round(avgPrice * 100) / 100,
        ebay_active_listings: activeListings,
        market_score: marketScore,
        last_updated: new Date(),
      };

      // Add seasonal columns if they exist (added by phase 2-5 migration)
      try {
        data.ebay_sold_30d = est30d;
        data.seasonal_weight = seasonalWeight;
      } catch (e) { /* columns may not exist yet */ }

      if (existing) {
        await database('market_demand_cache')
          .where('id', existing.id)
          .update(data);
      } else {
        data.part_number_base = partNumberBase;
        data.createdAt = new Date();
        await database('market_demand_cache').insert(data);
      }
    } catch (err) {
      this.log.warn({ err: err.message, partNumberBase }, 'market_demand_cache upsert failed');
    }
  }
}

function escapeXml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = MarketDemandCronRunner;
```
---
## FILE: service/lib/CronWorkRunner.js
```javascript
'use strict';
const { log } = require('./logger');
const SellerItemManager = require('../managers/SellerItemManager');
const Item = require('../models/Item');
const ItemDetailsManager = require('../managers/ItemDetailsManager');
const AsyncLock = require('async-lock');
const { v4: uuidv4 } = require('uuid');
const Cron = require('../models/Cron');
const CacheManager = require('../middleware/CacheManager');
const CompetitorManager = require('../managers/CompetitorManager');

const lock = new AsyncLock({ maxPending: 0, timeout: 1000 });
class CronWorkRunner {
  constructor() {
    this.log = log.child({ class: 'CronWorkRunner' }, true);
    this.lock = lock;
    this.cacheManager = new CacheManager();
  }

  async work() {
    const key = 'cronRunGather';

    if (this.lock.isBusy(key)) {
      this.log.debug('Cron gather is still running!');
      return;
    }

    try {
      await this.lock.acquire(key, async() => {
        this.log.info('lock acquired, starting cron work')
        await this.doWork();
      })
    } catch (err) {
      // DO NOT LET ERRORS ESCAPE, just log them
      if (err.message === 'async-lock timed out' || err.message === 'Too much pending tasks') {
        // this error shouldn't occur because of the isBusy check above
        this.log.warn(err, `Unable to acquire lock key ${key}, primary gather is already running`);
      } else {
        this.log.error({ err, message: err.message, stack: err.stack }, 'Unexpected error occurred during primary gather: ' + err.message);
      }
    }   
  }

  async doPreWork() {
    // clean up database
  }

  async doPostWork() {
    this.log.debug('Flushing all item based caches');
    this.cacheManager.delStartWith('item');
  }

  async doWork() {
    this.log.info('Running pre cron work taks');
    await this.doPreWork();

    const itemCount = await Item.query().count();
    this.log.info({ count: itemCount[0]['count'] }, `Currently found ${itemCount[0]['count']} items in our database`);

    // get the count of items that are unprocessed
    let skipNewItems = false;
    const items = await Item.query().where('processed', false);
    this.log.info({ count: items.length }, 'Found unprocessed items');
    if (items.length > 0) {
      this.log.info('Found unprocessed items, skipping import of new items and running processing instead');
      skipNewItems = true;
    }

    // if there are any unprocessed items, we want to skip pulling anything new from eBay
    if (!skipNewItems) {
      const sellerManager = new SellerItemManager();

      const competitorManager = new CompetitorManager();
      const sellers = await competitorManager.getAllCompetitors();

      await sellerManager.getItemsForSellers(sellers);

      const newItemCount = await Item.query().count();
      this.log.info({ newItemCount: newItemCount[0]['count'] }, `Currently found ${newItemCount[0]['count']} items in our database. ${newItemCount[0]['count'] - itemCount[0]['count']} new items added`);
    }

    const itemsManager = new ItemDetailsManager();
    const { total, processed, unprocessed, time, duplicateCount, apiCalls } =  await itemsManager.processItems();

    this.log.info({
      total, processed, unprocessed, time, duplicateCount, apiCalls
    }, '!! Metrics on latest cron route');

    // log info to database
    await Cron.query().insert({
      id: uuidv4(),
      total,
      processed,
      unprocessed,
      elapsed: time,
      duplicate: duplicateCount,
      apiCalls,
    });

    this.log.info('All items processed');

    this.log.info('Running post work');
    await this.doPostWork();
  }
}

module.exports = CronWorkRunner;```
---
## FILE: service/ebay/SoldItemsScraper.js
```javascript
'use strict';

const { log } = require('../lib/logger');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');

// Apply stealth plugin to avoid bot detection
chromium.use(stealth());

// User agents for rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];

/**
 * SoldItemsScraper - Scrapes eBay's sold items pages for market intelligence
 * Uses playwright-extra with stealth plugin to avoid bot detection
 */
class SoldItemsScraper {
  constructor() {
    this.log = log.child({ class: 'SoldItemsScraper' }, true);
    this.browser = null;
  }

  /**
   * Get a random user agent
   */
  getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  }

  /**
   * Random delay between requests (2-4 seconds)
   */
  async randomDelay() {
    const delay = 2000 + Math.random() * 2000;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Initialize the browser with stealth mode
   */
  async initBrowser() {
    if (!this.browser) {
      this.log.info('Launching stealth browser');
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920,1080',
        ],
      });
    }
    return this.browser;
  }

  /**
   * Close the browser
   */
  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Build the eBay sold items search URL
   * @param {Object} options
   * @param {string} options.seller - Seller username (optional)
   * @param {string} options.keywords - Search keywords (optional)
   * @param {string} options.categoryId - Category ID (default: 35596 for ECU)
   * @param {number} options.pageNumber - Page number (default: 1)
   */
  buildSearchUrl({ seller, keywords, categoryId = '0', pageNumber = 1 }) {
    const baseUrl = 'https://www.ebay.com/sch/i.html';
    const params = new URLSearchParams();

    // Add seller filter if specified
    if (seller) {
      params.set('_ssn', seller);
    }

    // Add keywords if specified
    if (keywords) {
      params.set('_nkw', keywords);
    }

    params.set('LH_Sold', '1'); // Sold items only
    params.set('LH_Complete', '1'); // Completed listings
    params.set('_sop', '13'); // Sort by end date: recent first

    // Only add category if it's a real category (not '0' or empty)
    if (categoryId && categoryId !== '0') {
      params.set('_sacat', categoryId);
    }

    params.set('_pgn', pageNumber.toString());
    params.set('_ipg', '60'); // Items per page

    return `${baseUrl}?${params.toString()}`;
  }

  /**
   * Scrape sold items by keyword search
   * Useful for finding competitors and market data for specific parts
   * @param {Object} options
   * @param {string} options.keywords - Search keywords
   * @param {string} options.categoryId - Category ID (default: 35596)
   * @param {number} options.maxPages - Maximum pages to scrape (default: 5)
   */
  async scrapeSoldItemsByKeywords({ keywords, categoryId = '35596', maxPages = 5 }) {
    this.log.info({ keywords, categoryId, maxPages }, 'Scraping sold items by keywords');

    const allItems = [];
    let pageNumber = 1;
    let hasMorePages = true;

    try {
      await this.initBrowser();
      const context = await this.browser.newContext({
        userAgent: this.getRandomUserAgent(),
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
        timezoneId: 'America/New_York',
      });

      const page = await context.newPage();

      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      });

      while (hasMorePages && pageNumber <= maxPages) {
        const url = this.buildSearchUrl({ keywords, categoryId, pageNumber });
        this.log.info({ url, pageNumber }, 'Scraping keyword search page');

        try {
          await page.goto(url, { waitUntil: 'load', timeout: 60000 });
          await page.waitForTimeout(5000);

          // Scroll to trigger lazy loading
          await page.evaluate(() => window.scrollTo(0, 500));
          await page.waitForTimeout(1000);
          await page.evaluate(() => window.scrollTo(0, 1000));
          await page.waitForTimeout(2000);

          try {
            await page.waitForSelector('ul.srp-results, .srp-river-results, li.s-item, li.s-card', { timeout: 15000 });
          } catch (e) {
            this.log.warn({ pageNumber }, 'Results not found');
          }

          // Extract items
          const items = await this.extractItemsFromPage(page, null);
          this.log.info({ pageNumber, itemCount: items.length }, 'Extracted items from keyword search');

          if (items.length === 0) {
            hasMorePages = false;
          } else {
            allItems.push(...items);
            pageNumber++;

            if (hasMorePages && pageNumber <= maxPages) {
              await this.randomDelay();
            }
          }
        } catch (pageError) {
          this.log.error({ err: pageError, pageNumber }, 'Error scraping keyword page');
          pageNumber++;
          await this.randomDelay();
        }
      }

      await context.close();
    } catch (err) {
      this.log.error({ err }, 'Error in keyword scraping process');
      throw err;
    }

    this.log.info({ keywords, totalItems: allItems.length }, 'Completed scraping by keywords');
    return allItems;
  }

  /**
   * Scrape sold items for a seller (all pages)
   * Note: Seller-only searches may not return results in eBay's new layout.
   * Consider using scrapeSoldItemsByKeywords for better results.
   * @param {Object} options
   * @param {string} options.seller - Seller username
   * @param {string} options.keywords - Search keywords (recommended for better results)
   * @param {string} options.categoryId - Category ID (default: 35596)
   * @param {number} options.maxPages - Maximum pages to scrape (default: 10)
   */
  async scrapeSoldItems({ seller, keywords, categoryId = '35596', maxPages = 10 }) {
    this.log.info({ seller, keywords, categoryId, maxPages }, 'Starting to scrape sold items with stealth browser');

    // Warn if no keywords provided - eBay's new layout may not show results
    if (!keywords) {
      this.log.warn({ seller }, 'No keywords provided - eBay may not return results for seller-only searches')
    }

    const allItems = [];
    let pageNumber = 1;
    let hasMorePages = true;

    try {
      await this.initBrowser();
      const context = await this.browser.newContext({
        userAgent: this.getRandomUserAgent(),
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
        timezoneId: 'America/New_York',
      });

      const page = await context.newPage();

      // Add some human-like behavior
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      });

      while (hasMorePages && pageNumber <= maxPages) {
        const url = this.buildSearchUrl({ seller, keywords, categoryId, pageNumber });
        this.log.info({ url, pageNumber }, 'Scraping page');

        try {
          // Navigate with extended timeout, wait for full load
          await page.goto(url, { waitUntil: 'load', timeout: 60000 });

          // Wait for JavaScript to render content
          await page.waitForTimeout(5000);

          // Check if we hit bot detection
          const pageContent = await page.content();
          if (pageContent.includes('Checking your browser') || pageContent.includes('Please verify')) {
            this.log.warn({ pageNumber }, 'Bot detection triggered, waiting and retrying...');
            await page.waitForTimeout(5000);
            await page.reload({ waitUntil: 'load' });
            await page.waitForTimeout(5000);
          }

          // Scroll to trigger lazy loading
          await page.evaluate(() => window.scrollTo(0, 500));
          await page.waitForTimeout(1000);
          await page.evaluate(() => window.scrollTo(0, 1000));
          await page.waitForTimeout(2000);

          // Wait for results container — try both layouts
          try {
            await page.waitForSelector('ul.srp-results, .srp-river-results, li.s-item, li.s-card', { timeout: 15000 });
          } catch (e) {
            this.log.warn({ pageNumber }, 'Results selector not found, page may be empty or blocked');
            // Log what we actually got for debugging
            const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
            this.log.warn({ pageNumber, bodySnippet: bodyText }, 'Page body preview');
          }

          // Detect which layout eBay served
          const layoutInfo = await page.evaluate(() => {
            const sCardCount = document.querySelectorAll('li.s-card').length;
            const sItemCount = document.querySelectorAll('li.s-item').length;
            const totalLi = document.querySelectorAll('ul.srp-results > li').length;
            return { sCardCount, sItemCount, totalLi };
          });
          this.log.info({ pageNumber, ...layoutInfo }, 'eBay layout detected');

          // Extract items from page
          const items = await this.extractItemsFromPage(page, seller);
          this.log.info({ pageNumber, itemCount: items.length }, 'Extracted items from page');

          if (items.length === 0) {
            hasMorePages = false;
          } else {
            allItems.push(...items);
            pageNumber++;

            // Random delay between pages
            if (hasMorePages && pageNumber <= maxPages) {
              await this.randomDelay();
            }
          }
        } catch (pageError) {
          this.log.error({ err: pageError, pageNumber }, 'Error scraping page');
          // Continue to next page on error
          pageNumber++;
          await this.randomDelay();
        }
      }

      await context.close();
    } catch (err) {
      this.log.error({ err }, 'Error in scraping process');
      throw err;
    }

    this.log.info({ seller, totalItems: allItems.length }, 'Completed scraping sold items');
    return allItems;
  }

  /**
   * Extract sold items from a page
   * Handles BOTH eBay layouts: new .s-card__* (2024+) and old .s-item__* (legacy)
   * eBay serves both layouts depending on the page/region/A-B test.
   * @param {Page} page - Playwright page object
   * @param {string} seller - Seller username for reference
   */
  async extractItemsFromPage(page, seller) {
    return await page.evaluate((sellerName) => {
      const items = [];

      // eBay uses ul.srp-results > li for both layouts
      const listings = document.querySelectorAll('ul.srp-results > li');

      listings.forEach((listing) => {
        try {
          // Find the link to get item ID — generic selector works for both layouts
          const linkEl = listing.querySelector('a.s-card__link') ||
                         listing.querySelector('a.s-item__link') ||
                         listing.querySelector('a.su-link') ||
                         listing.querySelector('a[href*="/itm/"]');
          if (!linkEl) return;

          const href = linkEl.getAttribute('href') || '';
          const itemIdMatch = href.match(/\/itm\/(\d+)/);
          const ebayItemId = itemIdMatch ? itemIdMatch[1] : null;

          // Skip promotional items and items without valid ID
          if (!ebayItemId || ebayItemId === '123456') return;

          // Title — new layout first, then old layout fallback
          const titleEl = listing.querySelector('.s-card__title span') ||
                          listing.querySelector('.s-card__title') ||
                          listing.querySelector('.s-item__title') ||
                          listing.querySelector('.su-card-container__header') ||
                          listing.querySelector('a[href*="/itm/"]');
          let title = titleEl?.textContent?.trim() || '';
          title = title.replace(/Opens in a new window or tab$/i, '').trim();
          title = title.replace(/^New Listing\s*/i, '').trim();

          // Price — new layout first, then old layout fallback
          const priceEl = listing.querySelector('.s-card__price') ||
                          listing.querySelector('.s-item__price') ||
                          listing.querySelector('[class*="price"]');
          let priceText = priceEl?.textContent?.trim() || '';
          if (priceText.includes(' to ')) {
            priceText = priceText.split(' to ')[0];
          }
          const soldPrice = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0;

          if (soldPrice === 0) return;

          // Condition/subtitle — new layout first, then old layout fallback
          const conditionEl = listing.querySelector('.s-card__subtitle span') ||
                             listing.querySelector('.s-card__subtitle') ||
                             listing.querySelector('.s-item__subtitle') ||
                             listing.querySelector('.SECONDARY_INFO');
          const condition = conditionEl?.textContent?.trim() || '';

          // Image — check data-src first (lazy loading), then src
          const imgEl = listing.querySelector('img.s-card__image') ||
                        listing.querySelector('.s-item__image-img') ||
                        listing.querySelector('.s-card__media-wrapper img') ||
                        listing.querySelector('img');
          const pictureUrl = imgEl?.getAttribute('data-src') || imgEl?.getAttribute('src') || '';

          // Sold date — try multiple patterns eBay uses across layouts
          let soldDate = null;
          const listingText = listing.textContent || '';
          // Pattern 1: "Sold Mar 15, 2026" or "Sold Mar 15 2026"
          // Pattern 2: "Sold 15 Mar 2026" (international format)
          // Pattern 3: "Sold 03/15/2026" or "Sold 3/15/2026"
          const datePatterns = [
            /Sold\s+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/,
            /Sold\s+(\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{4})/,
            /Sold\s+(\d{1,2}\/\d{1,2}\/\d{4})/,
          ];
          for (const pat of datePatterns) {
            const m = listingText.match(pat);
            if (m) {
              const parsed = new Date(m[1]);
              if (!isNaN(parsed.getTime())) { soldDate = parsed.toISOString(); break; }
            }
          }
          // Fallback: check for date-like elements (eBay sometimes puts date in a span)
          if (!soldDate) {
            const dateEl = listing.querySelector('.s-card__endedDate') ||
                           listing.querySelector('.s-item__endedDate') ||
                           listing.querySelector('[class*="endedDate"]') ||
                           listing.querySelector('[class*="sold-date"]');
            if (dateEl) {
              const parsed = new Date(dateEl.textContent.replace(/^Sold\s*/i, '').trim());
              if (!isNaN(parsed.getTime())) soldDate = parsed.toISOString();
            }
          }

          // Seller info — extract from listing if scraping keyword search (no seller filter)
          let itemSeller = sellerName;
          if (!itemSeller) {
            const sellerEl = listing.querySelector('.s-card__seller-info') ||
                            listing.querySelector('.s-item__seller-info-text') ||
                            listing.querySelector('[class*="seller"]');
            if (sellerEl) {
              const sellerText = sellerEl.textContent?.trim() || '';
              const sellerMatch = sellerText.match(/(?:from\s+|by\s+)?(\S+)/i);
              if (sellerMatch) itemSeller = sellerMatch[1];
            }
          }

          items.push({
            ebayItemId,
            title,
            soldPrice,
            soldDate,
            condition,
            pictureUrl,
            seller: itemSeller,
          });
        } catch (err) {
          console.error('Error parsing listing:', err);
        }
      });

      return items;
    }, seller);
  }

  /**
   * Parse items from HTML string (for testing with fixtures)
   * @param {string} html - HTML string
   */
  parseItemsFromHtml(html) {
    // This is a simplified version for testing
    // In production, we use Playwright's evaluate
    const items = [];
    const itemRegex = /\/itm\/(\d+)/g;
    let match;
    while ((match = itemRegex.exec(html)) !== null) {
      items.push({ ebayItemId: match[1] });
    }
    return items;
  }

  /**
   * Scrape sold items from multiple sellers
   * @param {Array<string>} sellers - Array of seller usernames
   * @param {Object} options
   * @param {string} options.categoryId - Category ID
   * @param {number} options.maxPagesPerSeller - Max pages per seller
   */
  async scrapeMultipleSellers(sellers, { categoryId = '35596', maxPagesPerSeller = 5 } = {}) {
    const allItems = [];

    try {
      await this.initBrowser();

      for (const seller of sellers) {
        try {
          const items = await this.scrapeSoldItems({
            seller,
            categoryId,
            maxPages: maxPagesPerSeller,
          });
          allItems.push(...items);

          // Delay between sellers
          await this.randomDelay();
        } catch (err) {
          this.log.error({ err, seller }, 'Error scraping seller, continuing to next');
        }
      }
    } finally {
      await this.closeBrowser();
    }

    return allItems;
  }
}

module.exports = SoldItemsScraper;
```
---
## FILE: service/ebay/MarketResearchScraper.js
```javascript
'use strict';

const { log } = require('../lib/logger');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');

// Apply stealth plugin to avoid bot detection
chromium.use(stealth());

// User agents for rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
];

/**
 * MarketResearchScraper - Comprehensive eBay market research
 *
 * Scrapes both active listings (competitors) and sold items for market intelligence.
 * Does NOT use any eBay API tokens - purely browser-based to avoid attribution.
 *
 * Flow:
 * 1. Search by keywords → get active listings (competitor prices)
 * 2. Apply "Sold Items" filter → get actual sale prices and dates
 */
class MarketResearchScraper {
  constructor() {
    this.log = log.child({ class: 'MarketResearchScraper' }, true);
    this.browser = null;
    this.context = null;
  }

  getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  }

  async randomDelay(min = 2000, max = 4000) {
    const delay = min + Math.random() * (max - min);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  async initBrowser() {
    if (!this.browser) {
      this.log.info('Launching stealth browser for market research');
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920,1080',
        ],
      });
    }

    if (!this.context) {
      this.context = await this.browser.newContext({
        userAgent: this.getRandomUserAgent(),
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
        timezoneId: 'America/New_York',
      });
    }

    return this.browser;
  }

  async closeBrowser() {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Extract search keywords from a listing title
   * Cleans up the title to create effective search terms
   */
  extractKeywords(title) {
    if (!title) return '';

    // Remove common noise words and special characters
    const noiseWords = [
      'oem', 'genuine', 'new', 'used', 'pre-owned', 'tested', 'working',
      'fits', 'for', 'the', 'and', 'with', 'free', 'shipping', 'fast',
      'warranty', 'day', 'return', 'returns', 'see', 'description',
    ];

    let keywords = title
      .toLowerCase()
      // Keep alphanumeric, spaces, and hyphens
      .replace(/[^a-z0-9\s-]/g, ' ')
      // Normalize spaces
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      // Remove noise words
      .filter(word => word.length > 1 && !noiseWords.includes(word))
      // Take first 8 meaningful words
      .slice(0, 8)
      .join(' ');

    return keywords;
  }

  /**
   * Build search URL for active listings
   */
  buildActiveListingsUrl({ keywords, categoryId = '35596', pageNumber = 1 }) {
    const params = new URLSearchParams({
      _nkw: keywords,
      _sacat: categoryId,
      _sop: '12', // Sort by: Best Match
      _ipg: '60', // Items per page
      _pgn: pageNumber.toString(),
    });
    return `https://www.ebay.com/sch/i.html?${params.toString()}`;
  }

  /**
   * Build search URL for sold items (add LH_Sold and LH_Complete filters)
   */
  buildSoldItemsUrl({ keywords, categoryId = '35596', pageNumber = 1 }) {
    const params = new URLSearchParams({
      _nkw: keywords,
      _sacat: categoryId,
      LH_Sold: '1',
      LH_Complete: '1',
      _sop: '13', // Sort by: End Date (recent first)
      _ipg: '60',
      _pgn: pageNumber.toString(),
    });
    return `https://www.ebay.com/sch/i.html?${params.toString()}`;
  }

  /**
   * Scrape active listings (competitors) for given keywords
   */
  async scrapeActiveListings({ keywords, categoryId = '35596', maxPages = 2 }) {
    this.log.info({ keywords, categoryId, maxPages }, 'Scraping active competitor listings');

    const allItems = [];
    let pageNumber = 1;

    try {
      await this.initBrowser();
      const page = await this.context.newPage();

      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      });

      while (pageNumber <= maxPages) {
        const url = this.buildActiveListingsUrl({ keywords, categoryId, pageNumber });
        this.log.info({ url, pageNumber }, 'Scraping active listings page');

        try {
          await page.goto(url, { waitUntil: 'load', timeout: 60000 });
          await page.waitForTimeout(5000);

          // Scroll for lazy loading
          await page.evaluate(() => window.scrollTo(0, 500));
          await page.waitForTimeout(1000);
          await page.evaluate(() => window.scrollTo(0, 1000));
          await page.waitForTimeout(2000);

          const items = await this.extractActiveListings(page, keywords);
          this.log.info({ pageNumber, itemCount: items.length }, 'Extracted active listings');

          if (items.length === 0) break;

          allItems.push(...items);
          pageNumber++;

          if (pageNumber <= maxPages) {
            await this.randomDelay();
          }
        } catch (err) {
          this.log.error({ err, pageNumber }, 'Error scraping active listings page');
          break;
        }
      }

      await page.close();
    } catch (err) {
      this.log.error({ err }, 'Error in active listings scraping');
      throw err;
    }

    return allItems;
  }

  /**
   * Extract active listing data from page
   */
  async extractActiveListings(page, keywords) {
    return await page.evaluate((searchKeywords) => {
      const items = [];
      const listings = document.querySelectorAll('ul.srp-results > li');

      listings.forEach((listing) => {
        try {
          const linkEl = listing.querySelector('a[href*="/itm/"]');
          if (!linkEl) return;

          const href = linkEl.getAttribute('href') || '';
          const itemIdMatch = href.match(/\/itm\/(\d+)/);
          const ebayItemId = itemIdMatch ? itemIdMatch[1] : null;

          if (!ebayItemId || ebayItemId === '123456') return;

          // Title — dual layout: new .s-card, old .s-item
          const titleEl = listing.querySelector('.s-card__title span') ||
                          listing.querySelector('.s-card__title') ||
                          listing.querySelector('.s-item__title') ||
                          listing.querySelector('a[href*="/itm/"]');
          let title = titleEl?.textContent?.trim() || '';
          title = title.replace(/Opens in a new window or tab$/i, '').trim();
          title = title.replace(/^New Listing\s*/i, '').trim();

          // Price — dual layout
          const priceEl = listing.querySelector('.s-card__price') ||
                          listing.querySelector('.s-item__price') ||
                          listing.querySelector('[class*="price"]');
          let priceText = priceEl?.textContent?.trim() || '';
          const currentPrice = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0;

          // Original price (strikethrough)
          const origPriceEl = listing.querySelector('.s-card__price--original, .s-item__price--original, [class*="STRIKETHROUGH"]');
          let originalPrice = null;
          if (origPriceEl) {
            const origText = origPriceEl.textContent?.trim() || '';
            originalPrice = parseFloat(origText.replace(/[^0-9.]/g, '')) || null;
          }

          if (currentPrice === 0) return;

          // Seller info — dual layout
          const sellerEl = listing.querySelector('.s-card__seller-info') ||
                           listing.querySelector('.s-item__seller-info-text') ||
                           listing.querySelector('[class*="seller"]');
          let seller = null;
          let sellerFeedbackScore = null;
          let sellerFeedbackPercent = null;

          if (sellerEl) {
            const sellerText = sellerEl.textContent?.trim() || '';
            const sellerMatch = sellerText.match(/([a-z0-9_-]+)\s+([\d.]+)%[^(]*\(([\d.]+K?)\)/i);
            if (sellerMatch) {
              seller = sellerMatch[1];
              sellerFeedbackPercent = parseFloat(sellerMatch[2]);
              let scoreStr = sellerMatch[3].replace('K', '000');
              sellerFeedbackScore = parseInt(scoreStr, 10);
            } else {
              const nameMatch = sellerText.match(/^([a-z0-9_-]+)/i);
              if (nameMatch) seller = nameMatch[1];
            }
          }

          // Condition — dual layout
          const conditionEl = listing.querySelector('.s-card__subtitle span') ||
                             listing.querySelector('.s-card__subtitle') ||
                             listing.querySelector('.s-item__subtitle') ||
                             listing.querySelector('.SECONDARY_INFO');
          const condition = conditionEl?.textContent?.trim() || '';

          // Shipping — dual layout
          const shippingEl = listing.querySelector('.s-item__logisticsCost') ||
                             listing.querySelector('.s-item__shipping') ||
                             listing.querySelector('[class*="shipping"]') ||
                             listing.querySelector('[class*="delivery"]');
          const shippingText = shippingEl?.textContent?.toLowerCase() || '';
          const freeShipping = shippingText.includes('free');
          let shippingCost = null;
          if (!freeShipping) {
            const shipMatch = shippingText.match(/\$?([\d.]+)\s*(?:shipping|delivery)/);
            if (shipMatch) shippingCost = parseFloat(shipMatch[1]);
          }

          // Free returns
          const returnsText = listing.textContent?.toLowerCase() || '';
          const freeReturns = returnsText.includes('free returns');

          // Sponsored
          const isSponsored = listing.textContent?.toLowerCase().includes('sponsored') || false;

          // Location
          const locationEl = listing.querySelector('[class*="location"]');
          const location = locationEl?.textContent?.replace('Located in', '').trim() || null;

          // Image — dual layout, prefer data-src for lazy loading
          const imgEl = listing.querySelector('img.s-card__image') ||
                        listing.querySelector('.s-item__image-img') ||
                        listing.querySelector('img');
          const pictureUrl = imgEl?.getAttribute('data-src') || imgEl?.getAttribute('src') || '';

          items.push({
            ebayItemId,
            title,
            currentPrice,
            originalPrice,
            seller,
            sellerFeedbackScore,
            sellerFeedbackPercent,
            condition,
            shippingCost,
            freeShipping,
            freeReturns,
            location,
            isSponsored,
            pictureUrl,
            viewItemUrl: href,
            keywords: searchKeywords,
          });
        } catch (err) {
          console.error('Error parsing active listing:', err);
        }
      });

      return items;
    }, keywords);
  }

  /**
   * Scrape sold items for given keywords
   */
  async scrapeSoldItems({ keywords, categoryId = '35596', maxPages = 3 }) {
    this.log.info({ keywords, categoryId, maxPages }, 'Scraping sold items');

    const allItems = [];
    let pageNumber = 1;

    try {
      await this.initBrowser();
      const page = await this.context.newPage();

      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      });

      while (pageNumber <= maxPages) {
        const url = this.buildSoldItemsUrl({ keywords, categoryId, pageNumber });
        this.log.info({ url, pageNumber }, 'Scraping sold items page');

        try {
          await page.goto(url, { waitUntil: 'load', timeout: 60000 });
          await page.waitForTimeout(5000);

          // Scroll for lazy loading
          await page.evaluate(() => window.scrollTo(0, 500));
          await page.waitForTimeout(1000);
          await page.evaluate(() => window.scrollTo(0, 1000));
          await page.waitForTimeout(2000);

          const items = await this.extractSoldItems(page, keywords);
          this.log.info({ pageNumber, itemCount: items.length }, 'Extracted sold items');

          if (items.length === 0) break;

          allItems.push(...items);
          pageNumber++;

          if (pageNumber <= maxPages) {
            await this.randomDelay();
          }
        } catch (err) {
          this.log.error({ err, pageNumber }, 'Error scraping sold items page');
          break;
        }
      }

      await page.close();
    } catch (err) {
      this.log.error({ err }, 'Error in sold items scraping');
      throw err;
    }

    return allItems;
  }

  /**
   * Extract sold item data from page
   */
  async extractSoldItems(page, keywords) {
    return await page.evaluate((searchKeywords) => {
      const items = [];
      const listings = document.querySelectorAll('ul.srp-results > li');

      listings.forEach((listing) => {
        try {
          const linkEl = listing.querySelector('a[href*="/itm/"]');
          if (!linkEl) return;

          const href = linkEl.getAttribute('href') || '';
          const itemIdMatch = href.match(/\/itm\/(\d+)/);
          const ebayItemId = itemIdMatch ? itemIdMatch[1] : null;

          if (!ebayItemId || ebayItemId === '123456') return;

          // Title — dual layout
          const titleEl = listing.querySelector('.s-card__title span') ||
                          listing.querySelector('.s-card__title') ||
                          listing.querySelector('.s-item__title') ||
                          listing.querySelector('a[href*="/itm/"]');
          let title = titleEl?.textContent?.trim() || '';
          title = title.replace(/Opens in a new window or tab$/i, '').trim();
          title = title.replace(/^New Listing\s*/i, '').trim();

          // Sold price — dual layout
          const priceEl = listing.querySelector('.s-card__price') ||
                          listing.querySelector('.s-item__price') ||
                          listing.querySelector('[class*="price"]');
          let priceText = priceEl?.textContent?.trim() || '';
          const soldPrice = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0;

          // Original price
          const origPriceEl = listing.querySelector('.s-card__price--original, .s-item__price--original, [class*="STRIKETHROUGH"]');
          let originalPrice = null;
          if (origPriceEl) {
            const origText = origPriceEl.textContent?.trim() || '';
            originalPrice = parseFloat(origText.replace(/[^0-9.]/g, '')) || null;
          }

          if (soldPrice === 0) return;

          // Sold date - look for "Sold Jan 16, 2026" pattern
          let soldDate = null;
          const listingText = listing.textContent || '';
          const soldDateMatch = listingText.match(/Sold\s+([A-Za-z]{3}\s+\d{1,2},?\s+\d{4})/);
          if (soldDateMatch) {
            const dateStr = soldDateMatch[1];
            const parsed = new Date(dateStr);
            if (!isNaN(parsed.getTime())) {
              soldDate = parsed.toISOString();
            }
          }

          // Seller info — dual layout
          const sellerEl = listing.querySelector('.s-card__seller-info') ||
                           listing.querySelector('.s-item__seller-info-text') ||
                           listing.querySelector('[class*="seller"]');
          let seller = null;
          let sellerFeedbackScore = null;
          let sellerFeedbackPercent = null;

          if (sellerEl) {
            const sellerText = sellerEl.textContent?.trim() || '';
            const sellerMatch = sellerText.match(/([a-z0-9_-]+)\s+([\d.]+)%[^(]*\(([\d.]+K?)\)/i);
            if (sellerMatch) {
              seller = sellerMatch[1];
              sellerFeedbackPercent = parseFloat(sellerMatch[2]);
              let scoreStr = sellerMatch[3].replace('K', '000');
              sellerFeedbackScore = parseInt(scoreStr, 10);
            } else {
              const nameMatch = sellerText.match(/^([a-z0-9_-]+)/i);
              if (nameMatch) seller = nameMatch[1];
            }
          }

          // Condition — dual layout
          const conditionEl = listing.querySelector('.s-card__subtitle span') ||
                             listing.querySelector('.s-card__subtitle') ||
                             listing.querySelector('.s-item__subtitle') ||
                             listing.querySelector('.SECONDARY_INFO');
          const condition = conditionEl?.textContent?.trim() || '';

          // Shipping
          const shippingText = listing.textContent?.toLowerCase() || '';
          const freeShipping = shippingText.includes('free delivery') || shippingText.includes('free shipping');
          let shippingCost = null;
          const shipMatch = shippingText.match(/\+\s*\$?([\d.]+)\s*(?:shipping|delivery)/);
          if (shipMatch) shippingCost = parseFloat(shipMatch[1]);

          // Location
          const locationMatch = listingText.match(/Located in\s+([^·\n]+)/i);
          const location = locationMatch ? locationMatch[1].trim() : null;

          // Image — dual layout, prefer data-src
          const imgEl = listing.querySelector('img.s-card__image') ||
                        listing.querySelector('.s-item__image-img') ||
                        listing.querySelector('img');
          const pictureUrl = imgEl?.getAttribute('data-src') || imgEl?.getAttribute('src') || '';

          items.push({
            ebayItemId,
            title,
            soldPrice,
            originalPrice,
            soldDate,
            seller,
            sellerFeedbackScore,
            sellerFeedbackPercent,
            condition,
            shippingCost,
            freeShipping,
            location,
            pictureUrl,
            viewItemUrl: href,
            keywords: searchKeywords,
          });
        } catch (err) {
          console.error('Error parsing sold item:', err);
        }
      });

      return items;
    }, keywords);
  }

  /**
   * Full market research for a set of keywords
   * Returns both active listings and sold items
   */
  async fullMarketResearch({ keywords, categoryId = '35596', maxActivePages = 2, maxSoldPages = 3 }) {
    this.log.info({ keywords, categoryId }, 'Starting full market research');

    try {
      await this.initBrowser();

      // Scrape active listings
      const activeListings = await this.scrapeActiveListings({
        keywords,
        categoryId,
        maxPages: maxActivePages,
      });

      await this.randomDelay(3000, 5000);

      // Scrape sold items
      const soldItems = await this.scrapeSoldItems({
        keywords,
        categoryId,
        maxPages: maxSoldPages,
      });

      this.log.info({
        keywords,
        activeListings: activeListings.length,
        soldItems: soldItems.length,
      }, 'Completed full market research');

      return {
        activeListings,
        soldItems,
      };
    } catch (err) {
      this.log.error({ err, keywords }, 'Error in full market research');
      throw err;
    }
  }
}

module.exports = MarketResearchScraper;
```
---
## FILE: service/services/PostScrapeService.js
```javascript
'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const axios = require('axios');
const TrimTierService = require('./TrimTierService');
const { getTrimTier } = require('../config/trim-tier-config');

/**
 * PostScrapeService — Universal post-scrape enrichment pipeline.
 *
 * Runs after ANY scraper completes for a yard:
 *   Step 1: Batch VIN decode via NHTSA (50 per call)
 *   Step 2: Trim tier matching (TrimTierService + trim_catalog + static config)
 *   Step 3: Scout alerts (background, non-blocking)
 *
 * Replaces the inline post-scrape hooks that were only in LKQScraper.
 */

function titleCase(str) {
  if (!str) return str;
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function cleanDecodedTrim(raw) {
  if (!raw) return null;
  let t = raw.trim();
  if (!t) return null;

  const JUNK = new Set([
    'nfa','nfb','nfc','cma','std','sa','hev','phev',
    'n/a','na','unknown','standard','unspecified',
    'styleside','flareside','stepside','sportside',
    'crew','crew cab','regular cab','extended cab','supercab','supercrew','double cab','quad cab','king cab','access cab',
    'middle level','middle-low level','high level','low level',
    'middle grade','middle-low grade','high grade','low grade',
    'xdrive','sdrive','4matic','quattro',
    'leather','cloth','premium cloth',
    'f-series','f series',
  ]);
  if (JUNK.has(t.toLowerCase())) return null;

  t = t.replace(/\s*\([^)]*\)\s*/g, '').trim();
  t = t.replace(/\b[VIL][\-\s]?\d\b/gi, '').trim();
  t = t.replace(/\b\d\.\d[A-Z]?\s*(L|LITER)?\b/gi, '').trim();
  t = t.replace(/\bW\/LEA(THER)?\b/gi, '-L').trim();
  t = t.replace(/\bWITH\s+LEATHER\b/gi, '-L').trim();
  t = t.replace(/\bW\/NAV(I|IGATION)?\b/gi, '').trim();
  t = t.replace(/\bW\/RES\b/gi, '').trim();
  t = t.replace(/\bWITH\s+RES\b/gi, '').trim();
  t = t.replace(/\bWITH\s+NAV(IGATION)?\b/gi, '').trim();
  t = t.replace(/\s+\-/g, '-').replace(/\-\s+/g, '-').replace(/\s+/g, ' ').trim();

  if (/^[A-Z]{0,3}\d{2,3}[A-Z]?$/i.test(t)) return null;
  if (/^\d\.\d[a-z]{1,2}$/i.test(t)) return null;

  if (/,/.test(t)) t = t.split(',')[0].trim();
  if (/\//.test(t)) {
    const parts = t.split('/').map(p => p.trim()).filter(Boolean);
    t = parts[parts.length - 1];
  }

  if (!t || t.length < 2 || t.length > 30) return null;
  return t;
}

async function decodeBatch(vins) {
  const data = `format=json&data=${vins.join(';')}`;
  try {
    const response = await axios.post(
      'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVINValuesBatch/',
      data,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30000,
      }
    );
    return response.data?.Results || [];
  } catch (err) {
    log.warn({ err: err.message }, 'PostScrape: NHTSA batch error');
    return [];
  }
}

async function lookupTrimTier(year, make, model, trimName, engineDisplacement, transmission, drivetrain) {
  if (!trimName && !engineDisplacement) return { tier: null, extra: null };

  // Tier 1: trim_tier_reference (curated table)
  try {
    const ref = await TrimTierService.lookup(year, make, model, trimName, engineDisplacement, transmission, drivetrain);
    if (ref) return { tier: ref.tierString, extra: ref };
  } catch (e) {}

  // Tier 2: trim_catalog (eBay Taxonomy API)
  try {
    const match = await database('trim_catalog')
      .where('year', year)
      .whereRaw('LOWER(make) = ?', [make.toLowerCase()])
      .whereRaw('LOWER(model) = ?', [model.toLowerCase()])
      .whereRaw('LOWER(trim_name) = ?', [trimName.toLowerCase()])
      .first();
    if (match) return { tier: match.tier, extra: null };

    const firstWord = trimName.split(/\s+/)[0];
    if (firstWord && firstWord.length >= 2) {
      const partial = await database('trim_catalog')
        .where('year', year)
        .whereRaw('LOWER(make) = ?', [make.toLowerCase()])
        .whereRaw('LOWER(model) = ?', [model.toLowerCase()])
        .whereRaw('LOWER(trim_name) LIKE ?', [firstWord.toLowerCase() + '%'])
        .first();
      if (partial) return { tier: partial.tier, extra: null };
    }
  } catch (e) {}

  // Tier 3: static config fallback
  const result = getTrimTier(make, trimName);
  return { tier: result.tier, extra: null };
}

/**
 * enrichYard — Run the full post-scrape enrichment pipeline for one yard.
 *
 * @param {string} yardId - UUID of the yard to enrich
 * @returns {{ vinsDecoded, trimsTiered, errors }}
 */
async function enrichYard(yardId) {
  const startTime = Date.now();
  const plog = log.child({ service: 'PostScrape', yardId }, true);
  const stats = { vinsDecoded: 0, trimsTiered: 0, errors: 0 };

  // ── STEP 1: VIN DECODE ──────────────────────────────────
  try {
    const rows = await database('yard_vehicle')
      .where('yard_id', yardId)
      .whereNotNull('vin')
      .whereRaw("LENGTH(vin) = 17")
      .whereNull('vin_decoded_at')
      .select('id', 'vin', 'year', 'make', 'model')
      .limit(500);

    plog.info({ count: rows.length }, 'PostScrape: VIN decode starting');

    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50);
      const vins = batch.map(r => r.vin.trim().toUpperCase());
      const results = await decodeBatch(vins);

      if (results.length === 0) {
        stats.errors += batch.length;
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      const resultMap = {};
      for (const r of results) {
        if (r.VIN) resultMap[r.VIN.toUpperCase()] = r;
      }

      for (const row of batch) {
        const r = resultMap[row.vin.toUpperCase()];
        if (!r) {
          await database('yard_vehicle').where('id', row.id).update({ vin_decoded_at: new Date() });
          stats.vinsDecoded++;
          continue;
        }

        const decodedTrim = cleanDecodedTrim(r.Trim || null);
        const decodedEngine = r.DisplacementL ? `${r.DisplacementL}L` : null;
        const decodedDrivetrain = r.DriveType || null;
        let decodedTransmission = r.TransmissionStyle || null;
        const transmissionSpeeds = r.TransmissionSpeeds || null;
        const fuelType = r.FuelTypePrimary || null;
        const isDiesel = /diesel/i.test(fuelType || '') || /diesel|cummins|duramax|power.?stroke|tdi|cdi|ecodiesel|crd/i.test(decodedEngine || '');

        // Trim tier lookup
        let trimTier = null;
        let audioBrand = null;
        let expectedParts = null;
        let cult = false;
        const makeTc = titleCase(row.make || r.Make || '');
        const modelTc = titleCase(row.model || r.Model || '');
        const yearNum = parseInt(r.ModelYear || row.year) || 0;

        if (decodedTrim || decodedEngine) {
          const result = await lookupTrimTier(yearNum, makeTc, modelTc, decodedTrim, decodedEngine, decodedTransmission, decodedDrivetrain);
          trimTier = result.tier;
          if (result.extra) {
            audioBrand = result.extra.audioBrand;
            expectedParts = result.extra.expectedParts;
            cult = result.extra.cult;
            if (result.extra.transmission && !decodedTransmission) {
              decodedTransmission = result.extra.transmission;
            }
          }
        }

        const updateData = {
          decoded_trim: decodedTrim,
          decoded_engine: decodedEngine,
          decoded_drivetrain: decodedDrivetrain,
          decoded_transmission: decodedTransmission,
          transmission_speeds: transmissionSpeeds,
          trim_tier: trimTier,
          vin_decoded_at: new Date(),
          updatedAt: new Date(),
        };
        try { updateData.audio_brand = audioBrand; } catch (e) {}
        try { updateData.expected_parts = expectedParts; } catch (e) {}
        try { updateData.cult = cult; } catch (e) {}
        try { updateData.diesel = isDiesel; } catch (e) {}

        try {
          await database('yard_vehicle').where('id', row.id).update(updateData);
          stats.vinsDecoded++;
          if (trimTier) stats.trimsTiered++;
        } catch (e) {
          stats.errors++;
        }
      }

      // Rate limit between NHTSA batches
      if (i + 50 < rows.length) await new Promise(r => setTimeout(r, 1000));
    }

    plog.info({ vinsDecoded: stats.vinsDecoded }, 'PostScrape: VIN decode complete');
  } catch (err) {
    plog.error({ err: err.message }, 'PostScrape: VIN decode failed');
    stats.errors++;
  }

  // ── STEP 2: TRIM TIER for non-VIN vehicles ─────────────
  // Vehicles without VINs can still get trim tier from yard-scraped trim field
  try {
    const untiered = await database('yard_vehicle')
      .where('yard_id', yardId)
      .where('active', true)
      .whereNull('trim_tier')
      .whereNotNull('make')
      .whereNotNull('model')
      .select('id', 'year', 'make', 'model', 'trim', 'engine', 'drivetrain')
      .limit(500);

    if (untiered.length > 0) {
      plog.info({ count: untiered.length }, 'PostScrape: Trim tier matching (non-VIN)');

      for (const v of untiered) {
        try {
          const makeTc = titleCase(v.make);
          const modelTc = titleCase(v.model);
          const yearNum = parseInt(v.year) || 0;
          const trimName = v.trim || null;
          const engineDisp = v.engine || null;
          const drivetr = v.drivetrain || null;

          if (!trimName && !engineDisp) continue;

          const result = await lookupTrimTier(yearNum, makeTc, modelTc, trimName, engineDisp, null, drivetr);
          if (result.tier) {
            const upd = { trim_tier: result.tier, updatedAt: new Date() };
            if (result.extra) {
              if (result.extra.cult) upd.cult = true;
              if (result.extra.diesel) upd.diesel = true;
              if (result.extra.audioBrand) upd.audio_brand = result.extra.audioBrand;
              if (result.extra.expectedParts) upd.expected_parts = result.extra.expectedParts;
            }
            await database('yard_vehicle').where('id', v.id).update(upd);
            stats.trimsTiered++;
          }
        } catch (e) {
          stats.errors++;
        }
      }
    }
  } catch (err) {
    plog.error({ err: err.message }, 'PostScrape: Trim tier matching failed');
  }

  // ── STEP 3: SCOUT ALERTS (non-blocking) ─────────────────
  try {
    const { generateAlerts } = require('./ScoutAlertService');
    generateAlerts().catch(err => {
      plog.warn({ err: err.message }, 'PostScrape: Scout alert generation failed');
    });
  } catch (e) { /* table may not exist yet */ }

  const elapsed = Date.now() - startTime;
  plog.info({ ...stats, elapsed }, 'PostScrape: enrichment complete');
  return stats;
}

module.exports = { enrichYard };
```
---
