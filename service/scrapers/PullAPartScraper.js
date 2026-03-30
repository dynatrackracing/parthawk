'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const { v4: uuidv4 } = require('uuid');

/**
 * Pull-A-Part Scraper — API-based via headed Playwright
 *
 * Pull-A-Part's inventory data comes from their internal APIs:
 *   - enterpriseservice.pullapart.com/Location?siteTypeID=-1  (locations)
 *   - inventoryservice.pullapart.com/Make/                    (makes list)
 *   - inventoryservice.pullapart.com/Model?makeID=X           (models per make)
 *   - inventoryservice.pullapart.com/Vehicle/Search (POST)    (vehicle search)
 *
 * These APIs require a REAL browser TLS handshake (headless fails on Windows).
 * Playwright must run in headed mode (headless: false).
 *
 * Location IDs (from enterprise service):
 *   Birmingham = 5, Knoxville = 10, Nashville = 6, Charlotte = 7
 *
 * Search returns vehicles per-make. We iterate all makes to get full inventory.
 */
class PullAPartScraper {
  constructor() {
    this.log = log.child({ class: 'PullAPartScraper' }, true);
  }

  async scrapeByYardName(yardName) {
    const yard = await database('yard').where('name', yardName).first();
    if (!yard) return { location: yardName, success: false, error: 'Yard not in database' };
    return this.scrapeYard(yard);
  }

  async scrapeYard(yard) {
    this.log.info({ yard: yard.name }, 'Scraping Pull-A-Part: ' + yard.name);

    const vehicles = await this.fetchInventoryViaAPI(yard);
    if (!vehicles || vehicles.length === 0) {
      this.log.warn({ yard: yard.name }, 'No vehicles returned from Pull-A-Part');
      return { location: yard.name, success: true, count: 0 };
    }

    // Mark existing as inactive
    await database('yard_vehicle').where('yard_id', yard.id).where('active', true)
      .update({ active: false, updatedAt: new Date() });

    let inserted = 0, updated = 0;
    for (const v of vehicles) {
      try {
        const existing = await database('yard_vehicle')
          .where('yard_id', yard.id).where('year', v.year)
          .where('make', v.make).where('model', v.model).first();
        if (existing) {
          const upd = {
            trim: v.trim || existing.trim,
            color: v.color || existing.color,
            row_number: v.row || existing.row_number,
            date_added: v.dateAdded || existing.date_added,
            active: true, last_seen: new Date(),
            scraped_at: new Date(), updatedAt: new Date(),
          };
          if (v.vin && v.vin.length >= 11) upd.vin = v.vin;
          await database('yard_vehicle').where('id', existing.id).update(upd);
          updated++;
        } else {
          await database('yard_vehicle').insert({
            id: uuidv4(), yard_id: yard.id, year: v.year, make: v.make, model: v.model,
            trim: v.trim || null, color: v.color || null, row_number: v.row || null,
            vin: v.vin || null, date_added: v.dateAdded || null,
            active: true, first_seen: new Date(), last_seen: new Date(),
            scraped_at: new Date(), createdAt: new Date(), updatedAt: new Date(),
          });
          inserted++;
        }
      } catch (err) {
        this.log.warn({ err: err.message }, 'Insert failed');
      }
    }

    await database('yard').where('id', yard.id).update({ last_scraped: new Date(), updatedAt: new Date() });
    this.log.info({ location: yard.name, total: vehicles.length, inserted, updated }, 'Pull-A-Part scrape complete');
    return { location: yard.name, success: true, total: vehicles.length, inserted, updated };
  }

  /**
   * Fetch inventory via Pull-A-Part's internal REST APIs.
   * Requires headed Playwright (headless: false) because the API services
   * reject TLS handshakes from headless browsers on Windows.
   */
  async fetchInventoryViaAPI(yard) {
    let chromium;
    try {
      const pw = require('playwright');
      chromium = pw.chromium;
    } catch (err) {
      this.log.error('Playwright not available for Pull-A-Part scrape');
      return [];
    }

    // Extract locationId from yard record, or use known mappings
    const locationId = yard.pullapart_location_id || this.resolveLocationId(yard.name);
    if (!locationId) {
      this.log.error({ yard: yard.name }, 'No Pull-A-Part location ID — set pullapart_location_id on yard row');
      return [];
    }

    const vehicles = [];
    const browser = await chromium.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
             '--window-position=-2400,-2400', '--window-size=800,600'],
    });

    try {
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();

      // Navigate to inventory page to establish session and get API access
      await page.goto('https://www.pullapart.com/inventory/', {
        waitUntil: 'domcontentloaded', timeout: 30000
      });
      // Wait for JS to fully init (apiEndpoints Map must be populated)
      await page.waitForTimeout(8000);

      // Verify API access is available
      const hasApi = await page.evaluate(() =>
        !!(window.apiEndpoints && window.apiEndpoints.get('PullAPartInventoryServiceBaseUrl'))
      );
      if (!hasApi) {
        this.log.error({ yard: yard.name }, 'Pull-A-Part API endpoints not available — page may not have loaded');
        await browser.close();
        return [];
      }

      // Step 1: Get makes that are actually ON YARD at this location
      const makes = await Promise.race([
        page.evaluate(async (locId) => {
          const base = window.apiEndpoints.get('PullAPartInventoryServiceBaseUrl');
          return jQuery.ajax({ crossDomain: true, dataType: 'json', traditional: true,
            url: base + '/Make/OnYard', data: { locations: [locId] } });
        }, locationId),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Makes fetch timeout')), 30000))
      ]);

      if (!Array.isArray(makes) || makes.length === 0) {
        this.log.error({ yard: yard.name }, 'Failed to fetch makes from Pull-A-Part API');
        await browser.close();
        return [];
      }

      this.log.info({ makeCount: makes.length, yard: yard.name }, 'Fetched makes on yard');

      // Step 2: For each make, get models then search vehicles
      const allYears = Array.from({ length: 65 }, (_, i) => 2026 - i);

      for (let mi = 0; mi < makes.length; mi++) {
        const make = makes[mi];
        try {
          // Get + search in a single page.evaluate to minimize round trips
          const searchResult = await Promise.race([
            page.evaluate(async (params) => {
              const base = window.apiEndpoints.get('PullAPartInventoryServiceBaseUrl');

              // Get models
              const modelsResp = await jQuery.ajax({ crossDomain: true, dataType: 'json',
                url: base + '/Model?makeID=' + params.makeID });
              if (!modelsResp || !modelsResp.length) return { empty: true };

              // Search vehicles
              const result = await jQuery.ajax({ crossDomain: true, dataType: 'json',
                contentType: 'application/json', method: 'POST',
                url: base + '/Vehicle/Search',
                data: JSON.stringify({
                  Locations: [params.locationId],
                  MakeID: params.makeID,
                  Models: modelsResp.map(m => m.modelID),
                  Years: params.years
                })
              });
              return result;
            }, { locationId, makeID: make.makeID, years: allYears }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 120000))
          ]);

          if (searchResult && (searchResult.error || searchResult.empty)) continue;
          if (!Array.isArray(searchResult)) continue;

          // Extract vehicles from results
          let makeCount = 0;
          for (const locationResult of searchResult) {
            const allVehicles = [
              ...(locationResult.exact || []),
              ...(locationResult.other || []),
            ];
            for (const v of allVehicles) {
              vehicles.push({
                year: String(v.modelYear),
                make: this.titleCase(v.makeName),
                model: this.titleCase(v.modelName),
                vin: v.vin || null,
                row: v.row ? String(v.row) : null,
                dateAdded: v.dateYardOn ? v.dateYardOn.split('T')[0] : null,
                color: null,
                trim: null,
              });
              makeCount++;
            }
          }

          this.log.info({ make: make.makeName, found: makeCount, progress: `${mi + 1}/${makes.length}` }, 'Make searched');

          // Rate limit — 1s between makes to avoid overwhelming their API
          await page.waitForTimeout(1000);

        } catch (err) {
          this.log.warn({ err: err.message, make: make.makeName }, 'Make search failed');
        }
      }

    } finally {
      await browser.close();
    }

    // Deduplicate by VIN (some vehicles appear in both exact and other)
    const seen = new Set();
    const deduped = [];
    for (const v of vehicles) {
      const key = v.vin || `${v.year}-${v.make}-${v.model}-${v.row}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(v);
      }
    }

    this.log.info({ count: deduped.length, raw: vehicles.length, yard: yard.name }, 'Pull-A-Part API scrape complete');
    return deduped;
  }

  /**
   * Resolve Pull-A-Part location ID from yard name.
   * Fallback when pullapart_location_id is not set on the yard row.
   */
  resolveLocationId(name) {
    const n = (name || '').toLowerCase();
    const map = {
      'birmingham': 5, 'montgomery': 13, 'atlanta south': 3, 'atlanta north': 4,
      'atlanta east': 21, 'augusta': 9, 'nashville': 6, 'knoxville': 10,
      'memphis': 17, 'charlotte': 7, 'winston': 19, 'louisville': 8,
      'indianapolis': 18, 'jackson': 15, 'baton rouge': 16, 'lafayette': 12,
      'new orleans': 14, 'columbia': 20, 'akron': 25, 'canton': 24,
      'cleveland': 11, 'cincinnati': 35, 'houston': 41, 'corpus christi': 30,
      'el paso': 29, 'pittsburgh': 42,
    };
    for (const [key, id] of Object.entries(map)) {
      if (n.includes(key)) return id;
    }
    return null;
  }

  titleCase(str) {
    if (!str) return str;
    return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }
}

module.exports = PullAPartScraper;
