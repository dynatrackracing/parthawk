'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const { v4: uuidv4 } = require('uuid');

/**
 * Foss U-Pull-It Scraper
 * fossupullit.com — Dynamic JS site, Puppeteer required.
 * On-demand scrape only (not nightly). Manual trigger from attack list.
 *
 * Covers La Grange and Jacksonville NC locations.
 */
class FossScraper {
  constructor() {
    this.log = log.child({ class: 'FossScraper' }, true);
    this.locations = [
      { name: 'Foss U-Pull-It La Grange', city: 'La Grange' },
      { name: 'Foss U-Pull-It Jacksonville', city: 'Jacksonville' },
    ];
    this.baseUrl = 'https://www.fossupullit.com';
  }

  async scrapeAll() {
    this.log.info('Starting Foss U-Pull-It scrape');
    const results = [];
    for (const location of this.locations) {
      try {
        const result = await this.scrapeLocation(location);
        results.push(result);
      } catch (err) {
        this.log.error({ err, location: location.name }, 'Failed: ' + location.name);
        results.push({ location: location.name, success: false, error: err.message });
      }
    }
    return results;
  }

  async scrapeLocation(location) {
    this.log.info({ location: location.name }, 'Scraping ' + location.name);
    const yard = await database('yard').where('name', location.name).first();
    if (!yard) return { location: location.name, success: false, error: 'Yard not in database' };

    const vehicles = await this.fetchInventory(location);
    if (!vehicles || vehicles.length === 0) {
      this.log.warn({ location: location.name }, 'No vehicles returned from Foss');
      return { location: location.name, success: true, count: 0 };
    }

    // Mark all existing as inactive, then re-activate found ones
    await database('yard_vehicle').where('yard_id', yard.id).where('active', true)
      .update({ active: false, updatedAt: new Date() });

    let inserted = 0, updated = 0;
    for (const v of vehicles) {
      try {
        const existing = await database('yard_vehicle')
          .where('yard_id', yard.id).where('year', v.year)
          .where('make', v.make).where('model', v.model).first();
        if (existing) {
          await database('yard_vehicle').where('id', existing.id).update({
            trim: v.trim || null, color: v.color || null, row_number: v.row || null,
            date_added: v.dateAdded || null, active: true, scraped_at: new Date(), updatedAt: new Date(),
          });
          updated++;
        } else {
          await database('yard_vehicle').insert({
            id: uuidv4(), yard_id: yard.id, year: v.year, make: v.make, model: v.model,
            trim: v.trim || null, color: v.color || null, row_number: v.row || null,
            vin: v.vin || null, date_added: v.dateAdded || null,
            active: true, scraped_at: new Date(), createdAt: new Date(), updatedAt: new Date(),
          });
          inserted++;
        }
      } catch (err) {
        this.log.warn({ err: err.message }, 'Insert failed');
      }
    }

    await database('yard').where('id', yard.id).update({ last_scraped: new Date(), updatedAt: new Date() });
    this.log.info({ location: location.name, total: vehicles.length, inserted, updated }, 'Foss scrape complete');
    return { location: location.name, success: true, total: vehicles.length, inserted, updated };
  }

  async fetchInventory(location) {
    let chromium;
    try {
      const pw = require('playwright');
      chromium = pw.chromium;
    } catch (err) {
      this.log.error('Playwright not available for Foss scrape');
      return [];
    }

    const vehicles = [];
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    try {
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();

      // Navigate to inventory page with location filter
      const url = `${this.baseUrl}/inventory`;
      this.log.info({ url }, 'Foss: navigating to inventory');
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(3000);

      // Try to select location if there's a dropdown
      try {
        await page.evaluate((city) => {
          const selects = document.querySelectorAll('select');
          for (const sel of selects) {
            for (const opt of sel.options) {
              if (opt.text.toLowerCase().includes(city.toLowerCase())) {
                sel.value = opt.value;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                break;
              }
            }
          }
        }, location.city);
        await page.waitForTimeout(2000);
      } catch (e) {
        // Location selection may not be needed
      }

      // Scrape vehicles from the page
      const pageVehicles = await page.evaluate(() => {
        const results = [];

        // Strategy 1: data attributes
        document.querySelectorAll('[data-year], [data-make]').forEach(el => {
          const year = el.getAttribute('data-year') || el.querySelector('[data-year]')?.getAttribute('data-year');
          const make = el.getAttribute('data-make') || el.querySelector('[data-make]')?.getAttribute('data-make');
          const model = el.getAttribute('data-model') || el.querySelector('[data-model]')?.getAttribute('data-model');
          if (year && make && model && /^\d{4}$/.test(year)) {
            results.push({ year, make, model, row: el.getAttribute('data-row') || null });
          }
        });

        // Strategy 2: table rows
        if (results.length === 0) {
          document.querySelectorAll('table tbody tr, .inventory-table tr').forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 3) {
              const year = cells[0]?.textContent?.trim();
              const make = cells[1]?.textContent?.trim();
              const model = cells[2]?.textContent?.trim();
              if (year && make && model && /^\d{4}$/.test(year)) {
                results.push({
                  year, make, model,
                  row: cells.length > 3 ? cells[3]?.textContent?.trim() : null,
                  color: cells.length > 4 ? cells[4]?.textContent?.trim() : null,
                });
              }
            }
          });
        }

        // Strategy 3: card/list items with regex parsing
        if (results.length === 0) {
          const containers = document.querySelectorAll('.vehicle, .vehicle-row, .inventory-item, .vehicle-card, .car-item, li, .row');
          containers.forEach(el => {
            const text = el.innerText || '';
            const yearMatch = text.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
            const makeMatch = text.match(/\b(Ford|Chevy|Chevrolet|Dodge|Chrysler|Jeep|Ram|Toyota|Honda|Nissan|BMW|Mercedes|Mazda|Kia|Hyundai|Subaru|GMC|Buick|Cadillac|Lincoln|Infiniti|Lexus|Acura|Mitsubishi|Pontiac|Saturn|Volvo|Audi|Volkswagen|VW|Mini|Scion)\b/i);
            if (yearMatch && makeMatch) {
              const rowMatch = text.match(/Row\s*[:#]?\s*(\w+)/i);
              const remaining = text.replace(yearMatch[0], '').replace(makeMatch[0], '').trim();
              const model = remaining.split(/[\n,]/)[0].trim().slice(0, 40) || 'Unknown';
              results.push({
                year: yearMatch[0], make: makeMatch[0], model,
                row: rowMatch ? rowMatch[1] : null,
              });
            }
          });
        }

        return results;
      });

      vehicles.push(...pageVehicles);

      // Check for pagination and scrape additional pages
      let hasMore = true;
      let pageNum = 2;
      while (hasMore && pageNum <= 20) {
        const nextExists = await page.evaluate(() =>
          !!(document.querySelector('a[rel="next"], .pagination .next:not(.disabled), [aria-label="Next"], .next-page'))
        );
        if (!nextExists) break;

        try {
          await page.evaluate(() => {
            const next = document.querySelector('a[rel="next"], .pagination .next a, [aria-label="Next"], .next-page');
            if (next) next.click();
          });
          await page.waitForTimeout(2000);

          const moreVehicles = await page.evaluate(() => {
            const results = [];
            document.querySelectorAll('table tbody tr').forEach(row => {
              const cells = row.querySelectorAll('td');
              if (cells.length >= 3) {
                const year = cells[0]?.textContent?.trim();
                const make = cells[1]?.textContent?.trim();
                const model = cells[2]?.textContent?.trim();
                if (year && make && model && /^\d{4}$/.test(year)) {
                  results.push({ year, make, model, row: cells.length > 3 ? cells[3]?.textContent?.trim() : null });
                }
              }
            });
            return results;
          });

          if (moreVehicles.length === 0) hasMore = false;
          else vehicles.push(...moreVehicles);
          pageNum++;
        } catch (e) {
          hasMore = false;
        }
      }
    } finally {
      await browser.close();
    }

    this.log.info({ count: vehicles.length, location: location.name }, 'Foss Puppeteer complete');
    return vehicles;
  }
}

module.exports = FossScraper;
