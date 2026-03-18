'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const { v4: uuidv4 } = require('uuid');

/**
 * Pull-A-Part Scraper
 * pullapart.com — Same infrastructure covers U-Pull-&-Pay.
 * On-demand scrape only. Puppeteer required for JS-rendered inventory.
 */
class PullAPartScraper {
  constructor() {
    this.log = log.child({ class: 'PullAPartScraper' }, true);
    this.baseUrl = 'https://www.pullapart.com';
  }

  /**
   * Scrape a specific Pull-A-Part location by yard name.
   */
  async scrapeByYardName(yardName) {
    const yard = await database('yard').where('name', yardName).first();
    if (!yard) return { location: yardName, success: false, error: 'Yard not in database' };
    return this.scrapeYard(yard);
  }

  async scrapeYard(yard) {
    this.log.info({ yard: yard.name }, 'Scraping Pull-A-Part: ' + yard.name);

    const vehicles = await this.fetchInventory(yard);
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
    this.log.info({ location: yard.name, total: vehicles.length, inserted, updated }, 'Pull-A-Part scrape complete');
    return { location: yard.name, success: true, total: vehicles.length, inserted, updated };
  }

  async fetchInventory(yard) {
    let chromium;
    try {
      const pw = require('playwright');
      chromium = pw.chromium;
    } catch (err) {
      this.log.error('Playwright not available for Pull-A-Part scrape');
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

      // Pull-A-Part has location-specific inventory pages
      // Assumption: scrape_url in yard record points to the right location page
      const url = yard.scrape_url || `${this.baseUrl}/locations/`;
      this.log.info({ url }, 'Pull-A-Part: navigating');
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(3000);

      // Try to find and click "View Inventory" or similar link
      try {
        await page.evaluate(() => {
          const links = document.querySelectorAll('a');
          for (const link of links) {
            const text = (link.textContent || '').toLowerCase();
            if (text.includes('inventory') || text.includes('search') || text.includes('vehicles')) {
              link.click();
              return true;
            }
          }
          return false;
        });
        await new Promise(r => setTimeout(r, 3000));
      } catch (e) {
        // Already on inventory page
      }

      // Scrape vehicles
      const pageVehicles = await page.evaluate(() => {
        const results = [];

        // Strategy 1: structured data attributes
        document.querySelectorAll('[data-year], .vehicle-item, .inventory-row').forEach(el => {
          const year = el.getAttribute('data-year') || el.querySelector('.year')?.textContent?.trim();
          const make = el.getAttribute('data-make') || el.querySelector('.make')?.textContent?.trim();
          const model = el.getAttribute('data-model') || el.querySelector('.model')?.textContent?.trim();
          if (year && make && model && /^\d{4}$/.test(year)) {
            results.push({
              year, make, model,
              row: el.getAttribute('data-row') || el.querySelector('.row, .location')?.textContent?.trim() || null,
              color: el.getAttribute('data-color') || el.querySelector('.color')?.textContent?.trim() || null,
              dateAdded: el.querySelector('.date, .added')?.textContent?.trim() || null,
            });
          }
        });

        // Strategy 2: table parsing
        if (results.length === 0) {
          document.querySelectorAll('table tbody tr').forEach(row => {
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

        // Strategy 3: regex text parsing on card/list elements
        if (results.length === 0) {
          document.querySelectorAll('.vehicle, .car, .result-item, .card, li').forEach(el => {
            const text = el.innerText || '';
            const yearMatch = text.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
            const makeMatch = text.match(/\b(Ford|Chevy|Chevrolet|Dodge|Chrysler|Jeep|Ram|Toyota|Honda|Nissan|BMW|Mercedes|Mazda|Kia|Hyundai|Subaru|GMC|Buick|Cadillac|Lincoln|Infiniti|Lexus|Acura|Mitsubishi|Pontiac|Saturn|Volvo|Audi|Volkswagen|VW|Mini|Scion)\b/i);
            if (yearMatch && makeMatch) {
              const rowMatch = text.match(/Row\s*[:#]?\s*(\w+)/i);
              const remaining = text.replace(yearMatch[0], '').replace(makeMatch[0], '').trim();
              results.push({
                year: yearMatch[0], make: makeMatch[0],
                model: remaining.split(/[\n,]/)[0].trim().slice(0, 40) || 'Unknown',
                row: rowMatch ? rowMatch[1] : null,
              });
            }
          });
        }

        return results;
      });

      vehicles.push(...pageVehicles);

      // Handle pagination
      let pageNum = 2;
      while (pageNum <= 20) {
        const hasNext = await page.evaluate(() =>
          !!(document.querySelector('a[rel="next"], .pagination .next:not(.disabled), [aria-label="Next"]'))
        );
        if (!hasNext) break;

        try {
          await page.evaluate(() => {
            const next = document.querySelector('a[rel="next"], .pagination .next a, [aria-label="Next"]');
            if (next) next.click();
          });
          await page.waitForTimeout(3000);

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

          if (moreVehicles.length === 0) break;
          vehicles.push(...moreVehicles);
          pageNum++;
        } catch (e) {
          break;
        }
      }
    } finally {
      await browser.close();
    }

    this.log.info({ count: vehicles.length, yard: yard.name }, 'Pull-A-Part Puppeteer complete');
    return vehicles;
  }
}

module.exports = PullAPartScraper;
