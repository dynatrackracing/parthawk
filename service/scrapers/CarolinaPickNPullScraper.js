'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const { v4: uuidv4 } = require('uuid');

/**
 * Carolina Pick N Pull Scraper
 * carolinapicknpull.com — IP-blocked on cloud/datacenter IPs (403 from nginx).
 * MUST run from a residential IP (local machine), not Railway.
 * On-demand scrape only. Covers Cape Fear, Sandhills, Grand Strand locations.
 *
 * Site requires per-make+model search queries; no bulk inventory endpoint.
 * Columns: Make, Model, Year, Row, Date-In (no VIN, no color).
 * Location IDs: Wilmington=3, Conway=9, Fayetteville=10
 *
 * To run locally: node scripts/scrape-carolina.js (uses this scraper + local IP)
 */

const LOCATION_IDS = {
  'Carolina PNP Wilmington': '3',
  'Carolina PNP Fayetteville': '10',
  'Carolina PNP Conway SC': '9',
};

// Common makes to search — covers 95%+ of yard inventory
const MAKES = [
  'acura', 'audi', 'bmw', 'buick', 'cadillac', 'chevrolet', 'chevrolet truck',
  'chrysler', 'dodge', 'dodge truck', 'fiat', 'ford', 'ford truck', 'gmc truck',
  'honda', 'hyundai', 'infiniti', 'jaguar', 'jeep', 'kia', 'land rover',
  'lexus', 'lincoln', 'mazda', 'mercedes-benz', 'mercury', 'mini cooper',
  'mitsubishi', 'nissan', 'oldsmobile', 'plymouth', 'pontiac', 'saturn',
  'scion', 'subaru', 'suzuki', 'toyota', 'volkswagen', 'volvo',
];

class CarolinaPickNPullScraper {
  constructor() {
    this.log = log.child({ class: 'CarolinaPickNPullScraper' }, true);
    this.baseUrl = 'https://carolinapicknpull.com';
  }

  async scrapeYard(yard) {
    this.log.info({ yard: yard.name }, 'Scraping Carolina PNP: ' + yard.name);

    const locationId = LOCATION_IDS[yard.name];
    if (!locationId) {
      this.log.error({ yard: yard.name }, 'Unknown Carolina PNP location');
      return { location: yard.name, success: false, error: 'Unknown location ID for ' + yard.name };
    }

    const vehicles = await this.fetchInventory(locationId, yard.name);
    if (!vehicles || vehicles.length === 0) {
      this.log.warn({ yard: yard.name }, 'No vehicles returned');
      return { location: yard.name, success: true, total: 0, inserted: 0, updated: 0, deactivated: 0 };
    }

    // Mark all existing as inactive
    const deactivated = await database('yard_vehicle').where('yard_id', yard.id).where('active', true)
      .update({ active: false, updatedAt: new Date() });

    let inserted = 0, updated = 0;
    for (const v of vehicles) {
      try {
        // Match on yard_id + year + make + model (no VIN available)
        const existing = await database('yard_vehicle')
          .where('yard_id', yard.id).where('year', v.year)
          .where('make', v.make).where('model', v.model).first();

        if (existing) {
          await database('yard_vehicle').where('id', existing.id).update({
            row_number: v.row || null,
            date_added: v.dateAdded || null,
            active: true,
            scraped_at: new Date(),
            updatedAt: new Date(),
          });
          updated++;
        } else {
          await database('yard_vehicle').insert({
            id: uuidv4(),
            yard_id: yard.id,
            year: v.year,
            make: v.make,
            model: v.model,
            row_number: v.row || null,
            date_added: v.dateAdded || null,
            active: true,
            scraped_at: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          inserted++;
        }
      } catch (err) {
        this.log.warn({ err: err.message, vehicle: v }, 'Upsert failed');
      }
    }

    // Re-count how many stayed inactive
    const stillInactive = deactivated - updated;

    await database('yard').where('id', yard.id).update({ last_scraped: new Date(), updatedAt: new Date() });
    this.log.info({ location: yard.name, total: vehicles.length, inserted, updated, deactivated: stillInactive }, 'Carolina PNP scrape complete');
    return { location: yard.name, success: true, total: vehicles.length, inserted, updated, deactivated: stillInactive };
  }

  async fetchInventory(locationId, yardName) {
    let chromium;
    try {
      const { chromium: c } = require('playwright-extra');
      const stealth = require('puppeteer-extra-plugin-stealth');
      c.use(stealth());
      chromium = c;
    } catch (e) {
      try { chromium = require('playwright').chromium; }
      catch (e2) {
        try { chromium = require('playwright-core').chromium; }
        catch (e3) { this.log.error('Playwright not available'); return []; }
      }
    }

    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
    });

    const allVehicles = [];

    try {
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
      });
      const page = await context.newPage();

      // Navigate to inventory page first to pass Cloudflare
      this.log.info({ locationId, yardName }, 'Navigating to inventory page');
      await page.goto(this.baseUrl + '/inventory/', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(3000); // Let Cloudflare challenge resolve

      // Get available models for each make via the AJAX endpoint
      for (const make of MAKES) {
        try {
          const modelsUrl = this.baseUrl + '/wp-content/themes/Carolina-PnP/inventorySelectUpdater.php'
            + '?inventory-search=Search&location=' + locationId
            + '&make=' + encodeURIComponent(make) + '&model=&user-select=make';

          const modelsResponse = await page.evaluate(async (url) => {
            try {
              const r = await fetch(url);
              return await r.json();
            } catch (e) { return []; }
          }, modelsUrl);

          if (!Array.isArray(modelsResponse) || modelsResponse.length === 0) continue;

          // Search each model
          for (const model of modelsResponse) {
            try {
              const searchUrl = this.baseUrl + '/inventory/'
                + '?inventory-search=Search&location=' + locationId
                + '&make=' + encodeURIComponent(make)
                + '&model=' + encodeURIComponent(model);

              await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
              await page.waitForTimeout(500);

              // Parse the results table
              const rows = await page.evaluate(() => {
                const table = document.querySelector('table.inventoryData');
                if (!table) return [];
                const trs = table.querySelectorAll('tbody tr');
                const results = [];
                for (const tr of trs) {
                  const tds = tr.querySelectorAll('td');
                  if (tds.length < 5) continue; // skip header row
                  results.push({
                    make: (tds[0]?.textContent || '').trim(),
                    model: (tds[1]?.textContent || '').trim(),
                    year: (tds[2]?.textContent || '').trim(),
                    row: (tds[3]?.textContent || '').trim(),
                    dateIn: (tds[4]?.textContent || '').trim(),
                  });
                }
                return results;
              });

              for (const r of rows) {
                const year = parseInt(r.year);
                if (!year || year < 1980 || year > 2030) continue;
                if (!r.make || !r.model) continue;

                // Normalize make: "CHEVROLET TRUCK" → "CHEVROLET", "FORD TRUCK" → "FORD", "DODGE TRUCK" → "DODGE"
                let normalMake = r.make.toUpperCase().replace(/\s+TRUCK$/i, '');
                if (normalMake === 'MERCEDES') normalMake = 'MERCEDES-BENZ';
                if (normalMake === 'MINI COOPER') normalMake = 'MINI';

                // Parse date: "03/15/2026" → ISO date
                let dateAdded = null;
                if (r.dateIn) {
                  const parts = r.dateIn.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                  if (parts) dateAdded = parts[3] + '-' + parts[1] + '-' + parts[2];
                }

                allVehicles.push({
                  year,
                  make: normalMake,
                  model: r.model.toUpperCase(),
                  row: r.row || null,
                  dateAdded,
                });
              }
            } catch (modelErr) {
              // Skip individual model errors
            }
          }

          this.log.debug({ make, vehicles: allVehicles.length }, 'Progress: ' + make);
        } catch (makeErr) {
          this.log.warn({ err: makeErr.message, make }, 'Failed to fetch models for make');
        }
      }

      await context.close();
    } catch (err) {
      this.log.error({ err }, 'Carolina PNP fetch failed');
    } finally {
      await browser.close();
    }

    this.log.info({ locationId, yardName, total: allVehicles.length }, 'Carolina PNP inventory fetched');
    return allVehicles;
  }
}

module.exports = CarolinaPickNPullScraper;
