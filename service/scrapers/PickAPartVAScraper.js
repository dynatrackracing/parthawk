'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const { v4: uuidv4 } = require('uuid');

/**
 * Pick-A-Part Virginia Scraper
 * pickapartva.com — WordPress site, Cloudflare-protected.
 * MUST run from a residential IP (datacenter IPs get 403).
 * 2 VA locations: Fredericksburg, Stafford. ~6,000 vehicles total.
 *
 * Inventory pages: /inventory-search/ or /inventory/
 * Expected fields: Make, Model, Year, Row, possibly VIN/Color.
 * Per-location filtering via form dropdown or URL parameter.
 *
 * To run locally: node scripts/scrape-pickapartva.js
 */

// Map yard names to location identifiers (will be auto-detected from form)
const LOCATION_NAMES = {
  'Pick-A-Part Fredericksburg': 'Fredericksburg',
  'Pick-A-Part Stafford': 'Stafford',
};

class PickAPartVAScraper {
  constructor() {
    this.log = log.child({ class: 'PickAPartVAScraper' }, true);
    this.inventoryUrl = 'https://pickapartva.com/inventory-search/';
    this.fallbackUrl = 'https://pickapartva.com/inventory/';
  }

  async scrapeYard(yard) {
    this.log.info({ yard: yard.name }, 'Scraping Pick-A-Part VA: ' + yard.name);

    const locationName = LOCATION_NAMES[yard.name];
    if (!locationName) {
      this.log.error({ yard: yard.name }, 'Unknown Pick-A-Part VA location');
      return { location: yard.name, success: false, error: 'Unknown location for ' + yard.name };
    }

    const vehicles = await this.fetchInventory(locationName, yard.name);
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
        // Try VIN match first if available
        let existing = null;
        if (v.vin && v.vin.length >= 11) {
          existing = await database('yard_vehicle')
            .where('yard_id', yard.id).where('vin', v.vin).first();
        }
        if (!existing) {
          existing = await database('yard_vehicle')
            .where('yard_id', yard.id).where('year', v.year)
            .where('make', v.make).where('model', v.model).first();
        }

        if (existing) {
          await database('yard_vehicle').where('id', existing.id).update({
            vin: v.vin || existing.vin,
            color: v.color || null,
            row_number: v.row || null,
            date_added: v.dateAdded || existing.date_added,
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
            vin: v.vin || null,
            color: v.color || null,
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
        this.log.warn({ err: err.message, vin: v.vin }, 'Upsert failed');
      }
    }

    const stillInactive = deactivated - updated;
    await database('yard').where('id', yard.id).update({ last_scraped: new Date(), updatedAt: new Date() });
    this.log.info({ location: yard.name, total: vehicles.length, inserted, updated, deactivated: stillInactive }, 'Pick-A-Part VA scrape complete');
    return { location: yard.name, success: true, total: vehicles.length, inserted, updated, deactivated: stillInactive };
  }

  async fetchInventory(locationName, yardName) {
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
        locale: 'en-US',
        timezoneId: 'America/New_York',
      });
      const page = await context.newPage();

      // Try primary inventory URL, fallback to alternate
      let loaded = false;
      for (const url of [this.inventoryUrl, this.fallbackUrl]) {
        try {
          this.log.info({ url, yardName }, 'Navigating to inventory page');
          const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
          if (resp.status() === 200) {
            loaded = true;
            await page.waitForTimeout(3000);
            break;
          }
        } catch (e) {
          this.log.warn({ url, err: e.message }, 'Failed to load URL');
        }
      }

      if (!loaded) {
        this.log.error({ yardName }, 'Could not load inventory page (likely IP blocked — run from local machine)');
        await context.close();
        await browser.close();
        return [];
      }

      // Auto-discover page structure
      const pageInfo = await page.evaluate((targetLocation) => {
        const info = { strategy: null, vehicles: [] };

        // Strategy 1: Table-based inventory
        const tables = document.querySelectorAll('table');
        for (const table of tables) {
          const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent.trim().toLowerCase());
          if (headers.some(h => h.includes('year') || h.includes('make') || h.includes('model'))) {
            info.strategy = 'table';
            const rows = table.querySelectorAll('tbody tr, tr');
            for (const row of rows) {
              const cells = Array.from(row.querySelectorAll('td'));
              if (cells.length < 3) continue;
              // Map cells by header position
              const vehicle = {};
              cells.forEach((cell, i) => {
                const header = headers[i] || '';
                const val = cell.textContent.trim();
                if (header.includes('year')) vehicle.year = val;
                else if (header.includes('make')) vehicle.make = val;
                else if (header.includes('model')) vehicle.model = val;
                else if (header.includes('vin')) vehicle.vin = val;
                else if (header.includes('color')) vehicle.color = val;
                else if (header.includes('row')) vehicle.row = val;
                else if (header.includes('date') || header.includes('arrival')) vehicle.dateIn = val;
                else if (header.includes('location') || header.includes('store')) vehicle.store = val;
              });
              if (vehicle.year && vehicle.make) {
                // Filter by location if store column exists
                if (targetLocation && vehicle.store && !vehicle.store.toLowerCase().includes(targetLocation.toLowerCase())) continue;
                info.vehicles.push(vehicle);
              }
            }
            break;
          }
        }

        // Strategy 2: Card/div-based listing
        if (info.strategy === null) {
          const cards = document.querySelectorAll('[class*=vehicle], [class*=inventory], [class*=listing], .entry, .post');
          if (cards.length > 0) {
            info.strategy = 'cards';
            for (const card of cards) {
              const text = card.textContent;
              const yearMatch = text.match(/\b(19|20)\d{2}\b/);
              if (!yearMatch) continue;
              const vinMatch = text.match(/[A-HJ-NPR-Z0-9]{17}/);
              info.vehicles.push({
                year: yearMatch[0],
                make: '',
                model: '',
                vin: vinMatch ? vinMatch[0] : null,
                fullText: text.replace(/\s+/g, ' ').trim().substring(0, 100),
              });
            }
          }
        }

        // Strategy 3: Select dropdown with all vehicles
        if (info.strategy === null) {
          const selects = document.querySelectorAll('select');
          const makeSelect = Array.from(selects).find(s => {
            const label = (s.name || s.id || '').toLowerCase();
            return label.includes('make');
          });
          if (makeSelect) {
            info.strategy = 'form';
            info.makes = Array.from(makeSelect.options)
              .filter(o => o.value && o.value !== '' && o.value !== '0')
              .map(o => ({ id: o.value, name: o.text.trim() }));
          }
        }

        // Report page state
        info.title = document.title;
        info.bodyLength = document.body?.innerHTML?.length || 0;
        info.hasCloudflare = document.body?.innerHTML?.includes('Cloudflare') || false;

        return info;
      }, locationName);

      this.log.info({
        strategy: pageInfo.strategy,
        vehicleCount: pageInfo.vehicles.length,
        title: pageInfo.title,
        hasCloudflare: pageInfo.hasCloudflare,
      }, 'Page structure detected');

      if (pageInfo.hasCloudflare) {
        this.log.error({ yardName }, 'Cloudflare challenge detected — must run from residential IP');
        await context.close();
        await browser.close();
        return [];
      }

      if (pageInfo.strategy === 'table' || pageInfo.strategy === 'cards') {
        // Direct extraction worked
        for (const v of pageInfo.vehicles) {
          const year = parseInt(v.year);
          if (!year || year < 1980 || year > 2030) continue;
          allVehicles.push({
            year,
            make: (v.make || '').toUpperCase(),
            model: (v.model || '').toUpperCase(),
            vin: v.vin && v.vin.length >= 11 ? v.vin.toUpperCase() : null,
            color: v.color || null,
            row: v.row || null,
            dateAdded: v.dateIn || null,
          });
        }
      } else if (pageInfo.strategy === 'form' && pageInfo.makes) {
        // Form-based: iterate makes like Carolina PNP
        for (const make of pageInfo.makes) {
          try {
            await page.selectOption('select[name*=make], select[id*=make]', make.id);
            await page.waitForTimeout(1000);

            // Try to submit form
            const submitBtn = await page.$('button[type=submit], input[type=submit], button:has-text("Search"), button:has-text("search")');
            if (submitBtn) await submitBtn.click();
            await page.waitForTimeout(2000);

            // Parse any results
            const results = await page.evaluate(() => {
              const rows = [];
              document.querySelectorAll('table tr, [class*=result], [class*=vehicle]').forEach(el => {
                const text = el.textContent.replace(/\s+/g, ' ').trim();
                const yearMatch = text.match(/\b(19|20)\d{2}\b/);
                if (yearMatch) {
                  const vinMatch = text.match(/[A-HJ-NPR-Z0-9]{17}/);
                  rows.push({ text: text.substring(0, 120), year: yearMatch[0], vin: vinMatch ? vinMatch[0] : null });
                }
              });
              return rows;
            });

            for (const r of results) {
              allVehicles.push({
                year: parseInt(r.year),
                make: make.name.toUpperCase(),
                model: '', // Will need manual parsing from text
                vin: r.vin ? r.vin.toUpperCase() : null,
                color: null,
                row: null,
                dateAdded: null,
              });
            }
          } catch (makeErr) {
            // Skip make errors
          }
        }
      }

      await context.close();
    } catch (err) {
      this.log.error({ err }, 'Pick-A-Part VA fetch failed');
    } finally {
      await browser.close();
    }

    this.log.info({ locationName, yardName, total: allVehicles.length }, 'Pick-A-Part VA inventory fetched');
    return allVehicles;
  }
}

module.exports = PickAPartVAScraper;
