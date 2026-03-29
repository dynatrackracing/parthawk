'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const { v4: uuidv4 } = require('uuid');

/**
 * Chesterfield Auto Parts Scraper
 * chesterfieldauto.com — Server-rendered search page that requires JS form interaction.
 * Playwright required (form submits reload page, table data only renders with JS).
 * 3 VA locations: Richmond, Midlothian (Southside), Fort Lee.
 *
 * Search page: /search-our-inventory-by-location/
 * Columns: Pics, Store, Make, Model, Year, Color, Body, Engine, Yard Row, Set
 * No VIN available in search results.
 *
 * Strategy: iterate all makes → get models → submit search → parse table rows.
 * Works from datacenter IPs (no IP blocking detected).
 */

// Map yard names to store names as shown in search results
const STORE_NAMES = {
  'Chesterfield Richmond': 'Richmond',
  'Chesterfield Midlothian': 'Southside',
  'Chesterfield Fort Lee': 'Ft. Lee',
};

class ChesterfieldScraper {
  constructor() {
    this.log = log.child({ class: 'ChesterfieldScraper' }, true);
    this.searchUrl = 'https://chesterfieldauto.com/search-our-inventory-by-location/';
  }

  async scrapeYard(yard) {
    this.log.info({ yard: yard.name }, 'Scraping Chesterfield: ' + yard.name);

    const storeName = STORE_NAMES[yard.name];
    if (!storeName) {
      this.log.error({ yard: yard.name }, 'Unknown Chesterfield location');
      return { location: yard.name, success: false, error: 'Unknown store name for ' + yard.name };
    }

    const vehicles = await this.fetchInventory(storeName, yard.name);
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
        const existing = await database('yard_vehicle')
          .where('yard_id', yard.id).where('year', v.year)
          .where('make', v.make).where('model', v.model).first();

        if (existing) {
          await database('yard_vehicle').where('id', existing.id).update({
            color: v.color || null,
            row_number: v.row || null,
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
            color: v.color || null,
            row_number: v.row || null,
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

    const stillInactive = deactivated - updated;
    await database('yard').where('id', yard.id).update({ last_scraped: new Date(), updatedAt: new Date() });
    this.log.info({ location: yard.name, total: vehicles.length, inserted, updated, deactivated: stillInactive }, 'Chesterfield scrape complete');
    return { location: yard.name, success: true, total: vehicles.length, inserted, updated, deactivated: stillInactive };
  }

  async fetchInventory(storeName, yardName) {
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
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const allVehicles = [];

    try {
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
      });
      const page = await context.newPage();

      // Load the search page
      this.log.info({ yardName }, 'Loading search page');
      await page.goto(this.searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2000);

      // Get all make options
      const makes = await page.evaluate(() => {
        const sel = document.getElementById('selected-make');
        if (!sel) return [];
        return Array.from(sel.options)
          .filter(o => o.value && o.value !== '0')
          .map(o => ({ id: o.value, name: o.text.trim() }));
      });

      this.log.info({ makeCount: makes.length, yardName }, 'Found makes');

      for (const make of makes) {
        try {
          // Select make — this reloads the page
          await page.goto(this.searchUrl + '?SelectedMake.Id=' + make.id, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(1000);

          // Get model options for this make
          const models = await page.evaluate(() => {
            const sel = document.getElementById('selected-model');
            if (!sel) return [];
            return Array.from(sel.options)
              .filter(o => o.value && o.value !== '0')
              .map(o => ({ id: o.value, name: o.text.trim() }));
          });

          if (models.length === 0) continue;

          for (const model of models) {
            try {
              // Select model and submit
              await page.goto(this.searchUrl + '?SelectedMake.Id=' + make.id + '&SelectedModel.Id=' + model.id, { waitUntil: 'domcontentloaded', timeout: 30000 });
              await page.waitForTimeout(1000);

              // Parse table rows
              const rows = await page.evaluate((targetStore) => {
                const table = document.querySelector('table');
                if (!table) return [];
                const trs = table.querySelectorAll('tbody tr, tr');
                const results = [];
                for (const tr of trs) {
                  const tds = tr.querySelectorAll('td');
                  if (tds.length < 8) continue; // skip header
                  const store = (tds[1]?.textContent || '').trim();
                  // Filter to target store if specified
                  if (targetStore && !store.toLowerCase().includes(targetStore.toLowerCase())) continue;
                  results.push({
                    store: store,
                    make: (tds[2]?.textContent || '').trim(),
                    model: (tds[3]?.textContent || '').trim(),
                    year: (tds[4]?.textContent || '').trim(),
                    color: (tds[5]?.textContent || '').trim(),
                    body: (tds[6]?.textContent || '').trim(),
                    engine: (tds[7]?.textContent || '').trim(),
                    row: (tds[8]?.textContent || '').trim(),
                  });
                }
                return results;
              }, storeName);

              for (const row of rows) {
                const year = parseInt(row.year);
                if (!year || year < 1980 || year > 2030) continue;
                if (!row.make) continue;

                allVehicles.push({
                  year,
                  make: row.make.toUpperCase(),
                  model: row.model.toUpperCase(),
                  color: row.color || null,
                  row: row.row || null,
                  engine: row.engine || null,
                });
              }
            } catch (modelErr) {
              // Skip individual model errors
            }
          }

          this.log.debug({ make: make.name, vehicles: allVehicles.length }, 'Progress');
        } catch (makeErr) {
          this.log.warn({ err: makeErr.message, make: make.name }, 'Make fetch failed');
        }
      }

      await context.close();
    } catch (err) {
      this.log.error({ err }, 'Chesterfield fetch failed');
    } finally {
      await browser.close();
    }

    this.log.info({ storeName, yardName, total: allVehicles.length }, 'Chesterfield inventory fetched');
    return allVehicles;
  }
}

module.exports = ChesterfieldScraper;
