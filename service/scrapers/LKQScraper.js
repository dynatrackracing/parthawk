'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const { v4: uuidv4 } = require('uuid');

/**
 * LKQ Pick Your Part Scraper
 * pyp.com is JS-rendered — uses Puppeteer with axios fallback
 *
 * Verified URLs (March 2026):
 *   pyp.com/inventory/raleigh-1168/
 *   pyp.com/inventory/durham-1142/
 *   pyp.com/inventory/greensboro-1226/
 *   pyp.com/inventory/east-nc-1227/
 */
class LKQScraper {
  constructor() {
    this.log = log.child({ class: 'LKQScraper' }, true);
    this.locations = [
      { name: 'LKQ Raleigh',    slug: 'raleigh-1168'    },
      { name: 'LKQ Durham',     slug: 'durham-1142'     },
      { name: 'LKQ Greensboro', slug: 'greensboro-1226' },
      { name: 'LKQ East NC',    slug: 'east-nc-1227'    },
    ];
  }

  async scrapeAll() {
    this.log.info('Starting LKQ scrape for all NC locations');
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
    this.log.info({ results }, 'LKQ scrape complete');
    return results;
  }

  async scrapeLocation(location) {
    this.log.info({ location: location.name }, 'Scraping ' + location.name);
    const yard = await database('yard').where('name', location.name).first();
    if (!yard) return { location: location.name, success: false, error: 'Yard not in database' };

    const vehicles = await this.fetchInventory(location);
    if (!vehicles || vehicles.length === 0) {
      this.log.warn({ location: location.name }, 'No vehicles returned');
      return { location: location.name, success: true, count: 0 };
    }

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
    this.log.info({ location: location.name, total: vehicles.length, inserted, updated }, 'Complete');
    return { location: location.name, success: true, total: vehicles.length, inserted, updated };
  }

  async fetchInventory(location) {
    try {
      return await this.fetchWithPuppeteer(location);
    } catch (err) {
      this.log.warn({ err: err.message }, 'Puppeteer failed, trying axios');
      return await this.fetchWithAxios(location);
    }
  }

  async fetchWithPuppeteer(location) {
    const puppeteer = require('puppeteer');
    const vehicles = [];

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
             '--no-first-run', '--no-zygote', '--single-process', '--disable-gpu'],
    });

    try {
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      let pageNum = 1;
      let hasMore = true;

      while (hasMore && pageNum <= 30) {
        const url = `https://www.pyp.com/inventory/${location.slug}/?page=${pageNum}`;
        this.log.info({ url, pageNum }, 'Puppeteer fetching page');

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
        await new Promise(r => setTimeout(r, 2000));

        const pageVehicles = await page.evaluate(() => {
          const results = [];

          // Try data-attribute rows
          document.querySelectorAll('[data-year]').forEach(el => {
            const year = el.getAttribute('data-year');
            const make = el.getAttribute('data-make');
            const model = el.getAttribute('data-model');
            if (year && make && model && /^\d{4}$/.test(year)) {
              results.push({
                year: year.trim(), make: make.trim(), model: model.trim(),
                row: el.getAttribute('data-row') || null,
                color: el.getAttribute('data-color') || null,
                vin: el.getAttribute('data-vin') || null,
              });
            }
          });

          // Try table rows
          if (results.length === 0) {
            document.querySelectorAll('table tbody tr').forEach(row => {
              const cells = row.querySelectorAll('td');
              if (cells.length >= 3) {
                const year = cells[0]?.textContent?.trim();
                const make = cells[1]?.textContent?.trim();
                const model = cells[2]?.textContent?.trim();
                const rowNum = cells[3]?.textContent?.trim();
                if (year && make && model && /^\d{4}$/.test(year)) {
                  results.push({ year, make, model, row: rowNum || null });
                }
              }
            });
          }

          // Try any element with vehicle class
          if (results.length === 0) {
            document.querySelectorAll('.vehicle, .vehicle-row, .inventory-item, .vehicle-card').forEach(el => {
              const text = el.innerText || '';
              const yearMatch = text.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
              const makeMatch = text.match(/\b(Ford|Chevy|Chevrolet|Dodge|Chrysler|Jeep|Ram|Toyota|Honda|Nissan|BMW|Mercedes|Mazda|Kia|Hyundai|Subaru|GMC|Buick|Cadillac|Lincoln|Infiniti|Lexus|Acura|Mitsubishi|Pontiac|Saturn|Volvo|Audi|Volkswagen|VW|Mini)\b/i);
              if (yearMatch && makeMatch) {
                const rowMatch = text.match(/Row\s*(\w+)/i);
                results.push({
                  year: yearMatch[0],
                  make: makeMatch[0],
                  model: text.replace(yearMatch[0], '').replace(makeMatch[0], '').trim().split('\n')[0].trim().slice(0, 30),
                  row: rowMatch ? rowMatch[1] : null,
                });
              }
            });
          }

          return results;
        });

        if (pageVehicles.length === 0) {
          hasMore = false;
        } else {
          vehicles.push(...pageVehicles);
          const hasNext = await page.evaluate(() =>
            !!(document.querySelector('a[rel="next"], .pagination .next:not(.disabled), [aria-label="Next"]'))
          );
          if (!hasNext) hasMore = false;
          pageNum++;
        }
      }
    } finally {
      await browser.close();
    }

    this.log.info({ count: vehicles.length, location: location.name }, 'Puppeteer complete');
    return vehicles;
  }

  async fetchWithAxios(location) {
    const axios = require('axios');
    const cheerio = require('cheerio');
    const vehicles = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= 30) {
      try {
        const url = `https://www.pyp.com/inventory/${location.slug}/?page=${page}`;
        const response = await axios.get(url, {
          timeout: 30000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,*/*',
          }
        });

        const $ = cheerio.load(response.data);
        const pageVehicles = [];

        $('[data-year]').each((i, el) => {
          const year = $(el).attr('data-year');
          const make = $(el).attr('data-make');
          const model = $(el).attr('data-model');
          if (year && make && model) {
            pageVehicles.push({ year, make, model, row: $(el).attr('data-row') || null });
          }
        });

        if (pageVehicles.length === 0) {
          $('table tbody tr').each((i, el) => {
            const cells = $(el).find('td');
            const year = $(cells[0]).text().trim();
            const make = $(cells[1]).text().trim();
            const model = $(cells[2]).text().trim();
            if (year && make && model && /^\d{4}$/.test(year)) {
              pageVehicles.push({ year, make, model, row: $(cells[3]).text().trim() || null });
            }
          });
        }

        if (pageVehicles.length === 0) { hasMore = false; }
        else {
          vehicles.push(...pageVehicles);
          if (!$('a[rel="next"]').length) hasMore = false;
          page++;
        }
      } catch (err) {
        this.log.error({ err: err.message, page }, 'Axios page failed');
        hasMore = false;
      }
    }

    return vehicles;
  }
}

module.exports = LKQScraper;
