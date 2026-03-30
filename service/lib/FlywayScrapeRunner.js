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
