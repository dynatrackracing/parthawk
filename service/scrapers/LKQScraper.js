'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const { v4: uuidv4 } = require('uuid');

/**
 * LKQ Pick Your Part Scraper
 * pyp.com is a CloudFlare-protected React SPA.
 *
 * Strategy (in order):
 *   1. Playwright with stealth — best CloudFlare bypass, intercepts XHR for data API
 *   2. Puppeteer-extra with stealth plugin — fallback browser automation
 *   3. Axios with full browser headers — last resort (usually blocked)
 *
 * Verified URL pattern: https://www.pyp.com/inventory/{slug}/?page={n}
 *   raleigh-1168, durham-1142, greensboro-1226, east-nc-1227
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
    // Strategy 1: Playwright (best CF bypass)
    try {
      const vehicles = await this.fetchWithPlaywright(location);
      if (vehicles.length > 0) return vehicles;
      this.log.warn('Playwright returned 0 vehicles, trying puppeteer-extra');
    } catch (err) {
      this.log.warn({ err: err.message }, 'Playwright failed, trying puppeteer-extra');
    }

    // Strategy 2: Puppeteer-extra with stealth
    try {
      const vehicles = await this.fetchWithPuppeteerStealth(location);
      if (vehicles.length > 0) return vehicles;
      this.log.warn('Puppeteer-stealth returned 0 vehicles, trying axios');
    } catch (err) {
      this.log.warn({ err: err.message }, 'Puppeteer-stealth failed, trying axios');
    }

    // Strategy 3: Axios (usually blocked by CF but worth trying)
    try {
      return await this.fetchWithAxios(location);
    } catch (err) {
      this.log.error({ err: err.message }, 'All scrape methods failed');
      return [];
    }
  }

  /**
   * Playwright approach — handles CloudFlare challenges natively.
   * Intercepts XHR/fetch to capture the inventory API response directly.
   */
  async fetchWithPlaywright(location) {
    const { chromium } = require('playwright');
    const vehicles = [];
    // Captured API responses (the SPA likely fetches vehicle data via XHR)
    const apiVehicles = [];

    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });

    try {
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1366, height: 768 },
        locale: 'en-US',
        timezoneId: 'America/New_York',
      });

      const page = await context.newPage();

      // Intercept API responses — the SPA likely loads vehicle data via fetch/XHR
      page.on('response', async (response) => {
        const url = response.url();
        const ct = response.headers()['content-type'] || '';
        // Capture any JSON response that looks like vehicle data
        if (ct.includes('json') && (url.includes('vehicle') || url.includes('inventory') || url.includes('search') || url.includes('api'))) {
          try {
            const json = await response.json();
            this.log.info({ url, keys: Object.keys(json) }, 'Intercepted API response');
            const extracted = this.extractFromApiResponse(json);
            if (extracted.length > 0) {
              apiVehicles.push(...extracted);
            }
          } catch (e) { /* not JSON or parse error */ }
        }
      });

      let pageNum = 1;
      let hasMore = true;

      while (hasMore && pageNum <= 30) {
        const url = `https://www.pyp.com/inventory/${location.slug}/?page=${pageNum}`;
        this.log.info({ url, pageNum }, 'Playwright navigating');

        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        } catch (navErr) {
          this.log.warn({ err: navErr.message, url }, 'Navigation timeout/error');
          // CloudFlare challenge page — wait for it to resolve
          try {
            await page.waitForTimeout(8000);
            // Try clicking the CF checkbox if it appears
            const cfBox = page.locator('#challenge-form, .cf-turnstile, iframe[src*="challenges"]');
            if (await cfBox.count() > 0) {
              this.log.info('CloudFlare challenge detected, waiting...');
              await page.waitForTimeout(10000);
            }
          } catch (e) { /* ignore */ }
        }

        // Wait for the page to actually render vehicle content
        // Try multiple possible selectors the SPA might use
        try {
          await page.waitForSelector(
            'table tbody tr, [class*="vehicle"], [class*="inventory"], [class*="car-"], [data-vehicle], main .row, #inventory-list, .results',
            { timeout: 15000 }
          );
        } catch (e) {
          this.log.warn('No vehicle elements found after wait, trying longer...');
          await page.waitForTimeout(5000);
        }

        // Scroll down to trigger lazy loading
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(2000);

        // Extract vehicles from the rendered DOM
        const pageVehicles = await page.evaluate(() => {
          return window.__extractPYPVehicles ? window.__extractPYPVehicles() : [];
        });

        // If injected function didn't work, try manual extraction
        let extracted = pageVehicles;
        if (!extracted || extracted.length === 0) {
          extracted = await this.extractFromPage(page);
        }

        if (extracted.length === 0 && pageNum === 1) {
          // On first page, dump page content for debugging
          const title = await page.title();
          const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || '');
          this.log.warn({ title, bodyText: bodyText.slice(0, 300) }, 'Page 1 returned no vehicles — dumping content');
        }

        if (extracted.length === 0) {
          hasMore = false;
        } else {
          vehicles.push(...extracted);
          // Check for next page
          const hasNext = await page.evaluate(() => {
            const next = document.querySelector('a[rel="next"], [class*="next"]:not([class*="disabled"]), [aria-label="Next"], a[href*="page="]');
            return !!next;
          });
          if (!hasNext) hasMore = false;
          pageNum++;
          // Be polite
          await page.waitForTimeout(1500 + Math.random() * 2000);
        }
      }
    } finally {
      await browser.close();
    }

    // Prefer API-intercepted data if we got any
    if (apiVehicles.length > 0) {
      this.log.info({ count: apiVehicles.length, location: location.name }, 'Using API-intercepted vehicle data');
      return apiVehicles;
    }

    this.log.info({ count: vehicles.length, location: location.name }, 'Playwright DOM extraction complete');
    return vehicles;
  }

  /**
   * Extract vehicles from a Playwright page using multiple DOM strategies.
   */
  async extractFromPage(page) {
    return await page.evaluate(() => {
      const results = [];

      // Strategy 1: data attributes (common in React SPAs)
      document.querySelectorAll('[data-year], [data-vehicle-year]').forEach(el => {
        const year = el.getAttribute('data-year') || el.getAttribute('data-vehicle-year');
        const make = el.getAttribute('data-make') || el.getAttribute('data-vehicle-make');
        const model = el.getAttribute('data-model') || el.getAttribute('data-vehicle-model');
        if (year && make && model && /^\d{4}$/.test(year)) {
          results.push({
            year: year.trim(), make: make.trim(), model: model.trim(),
            row: el.getAttribute('data-row') || el.getAttribute('data-location') || null,
            color: el.getAttribute('data-color') || null,
            vin: el.getAttribute('data-vin') || null,
          });
        }
      });
      if (results.length > 0) return results;

      // Strategy 2: table rows (classic inventory table)
      document.querySelectorAll('table tbody tr, table tr').forEach(row => {
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
              dateAdded: cells.length > 5 ? cells[5]?.textContent?.trim() : null,
            });
          }
        }
      });
      if (results.length > 0) return results;

      // Strategy 3: links or divs containing year/make/model patterns
      // PYP likely renders each vehicle as a card/row with text like "2019 Ford F-150"
      const allElements = document.querySelectorAll('a, div, li, article, section, tr, .card, [class*="vehicle"], [class*="inventory"], [class*="result"]');
      const seen = new Set();
      allElements.forEach(el => {
        const text = (el.textContent || '').trim();
        if (text.length < 10 || text.length > 200) return;
        // Match "YYYY Make Model" pattern
        const match = text.match(/\b((?:19|20)\d{2})\s+(Acura|Audi|BMW|Buick|Cadillac|Chevrolet|Chevy|Chrysler|Dodge|Fiat|Ford|Genesis|GMC|Honda|Hyundai|Infiniti|Jaguar|Jeep|Kia|Land\s*Rover|Lexus|Lincoln|Mazda|Mercedes|Mercury|Mini|Mitsubishi|Nissan|Pontiac|Porsche|Ram|Saturn|Scion|Subaru|Tesla|Toyota|Volkswagen|VW|Volvo)\s+([A-Za-z0-9][A-Za-z0-9 \-]{1,30})/i);
        if (match) {
          const key = `${match[1]}|${match[2]}|${match[3].trim()}`;
          if (!seen.has(key)) {
            seen.add(key);
            const rowMatch = text.match(/Row\s*[:#]?\s*([A-Za-z0-9]+)/i);
            const colorMatch = text.match(/\b(Black|White|Silver|Gray|Grey|Red|Blue|Green|Gold|Brown|Beige|Tan|Maroon|Orange|Yellow|Purple)\b/i);
            const dateMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
            results.push({
              year: match[1],
              make: match[2].trim(),
              model: match[3].trim().replace(/\s+(Row|Color|Date|Added).*$/i, ''),
              row: rowMatch ? rowMatch[1] : null,
              color: colorMatch ? colorMatch[1] : null,
              dateAdded: dateMatch ? dateMatch[1] : null,
            });
          }
        }
      });
      if (results.length > 0) return results;

      // Strategy 4: __NEXT_DATA__ or similar SSR data blob
      const nextData = document.getElementById('__NEXT_DATA__');
      if (nextData) {
        try {
          const data = JSON.parse(nextData.textContent);
          // Walk the object tree looking for arrays of vehicles
          const found = [];
          const walk = (obj, depth) => {
            if (depth > 5 || !obj) return;
            if (Array.isArray(obj)) {
              for (const item of obj) {
                if (item && typeof item === 'object' && (item.year || item.Year) && (item.make || item.Make)) {
                  found.push({
                    year: String(item.year || item.Year),
                    make: String(item.make || item.Make),
                    model: String(item.model || item.Model || ''),
                    row: item.row || item.Row || item.location || null,
                    color: item.color || item.Color || null,
                    dateAdded: item.dateAdded || item.date_added || item.arrivalDate || null,
                  });
                }
              }
            }
            if (typeof obj === 'object') {
              for (const val of Object.values(obj)) {
                walk(val, depth + 1);
              }
            }
          };
          walk(data, 0);
          if (found.length > 0) return found;
        } catch (e) { /* not valid JSON */ }
      }

      return results;
    });
  }

  /**
   * Extract vehicle data from an intercepted API JSON response.
   * Handles various API response shapes.
   */
  extractFromApiResponse(json) {
    const vehicles = [];

    // Try to find an array of vehicle-like objects anywhere in the response
    const walk = (obj, depth) => {
      if (depth > 6 || !obj) return;
      if (Array.isArray(obj)) {
        for (const item of obj) {
          if (item && typeof item === 'object') {
            const year = item.year || item.Year || item.vehicleYear || item.vehicle_year;
            const make = item.make || item.Make || item.vehicleMake || item.vehicle_make;
            const model = item.model || item.Model || item.vehicleModel || item.vehicle_model;
            if (year && make && model) {
              vehicles.push({
                year: String(year),
                make: String(make),
                model: String(model),
                trim: item.trim || item.Trim || null,
                row: item.row || item.Row || item.rowNumber || item.row_number || item.location || null,
                color: item.color || item.Color || item.exteriorColor || null,
                vin: item.vin || item.VIN || null,
                dateAdded: item.dateAdded || item.date_added || item.arrivalDate || item.arrival_date || null,
              });
            }
          }
        }
      }
      if (typeof obj === 'object' && !Array.isArray(obj)) {
        for (const val of Object.values(obj)) {
          walk(val, depth + 1);
        }
      }
    };

    walk(json, 0);
    return vehicles;
  }

  /**
   * Puppeteer-extra with stealth plugin — fallback for when Playwright fails.
   */
  async fetchWithPuppeteerStealth(location) {
    let puppeteer;
    try {
      puppeteer = require('puppeteer-extra');
      const StealthPlugin = require('puppeteer-extra-plugin-stealth');
      puppeteer.use(StealthPlugin());
    } catch (e) {
      this.log.warn('puppeteer-extra not available, using plain puppeteer');
      puppeteer = require('puppeteer');
    }

    const vehicles = [];
    const browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1366,768',
      ],
    });

    try {
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
      await page.setViewport({ width: 1366, height: 768 });

      // Override navigator properties to look more human
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      });

      // Intercept XHR responses
      const apiVehicles = [];
      page.on('response', async (response) => {
        const url = response.url();
        const ct = response.headers()['content-type'] || '';
        if (ct.includes('json') && (url.includes('vehicle') || url.includes('inventory') || url.includes('api'))) {
          try {
            const text = await response.text();
            const json = JSON.parse(text);
            const extracted = this.extractFromApiResponse(json);
            if (extracted.length > 0) apiVehicles.push(...extracted);
          } catch (e) { /* ignore */ }
        }
      });

      let pageNum = 1;
      let hasMore = true;

      while (hasMore && pageNum <= 30) {
        const url = `https://www.pyp.com/inventory/${location.slug}/?page=${pageNum}`;
        this.log.info({ url, pageNum }, 'Puppeteer-stealth fetching');

        try {
          await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        } catch (e) {
          this.log.warn({ err: e.message }, 'Navigation timeout — waiting for CF challenge');
          await new Promise(r => setTimeout(r, 10000));
        }

        // Wait for content — try multiple selectors
        await new Promise(r => setTimeout(r, 5000));

        // Scroll to trigger lazy loading
        await page.evaluate(() => {
          window.scrollBy(0, 300);
          setTimeout(() => window.scrollBy(0, 600), 500);
          setTimeout(() => window.scrollBy(0, document.body.scrollHeight), 1000);
        });
        await new Promise(r => setTimeout(r, 3000));

        const pageVehicles = await page.evaluate(() => {
          const results = [];

          // Try data attributes
          document.querySelectorAll('[data-year], [data-vehicle-year]').forEach(el => {
            const year = el.getAttribute('data-year') || el.getAttribute('data-vehicle-year');
            const make = el.getAttribute('data-make') || el.getAttribute('data-vehicle-make');
            const model = el.getAttribute('data-model') || el.getAttribute('data-vehicle-model');
            if (year && make && model && /^\d{4}$/.test(year)) {
              results.push({ year: year.trim(), make: make.trim(), model: model.trim(),
                row: el.getAttribute('data-row') || null, color: el.getAttribute('data-color') || null });
            }
          });
          if (results.length > 0) return results;

          // Try table rows
          document.querySelectorAll('table tbody tr, table tr').forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 3) {
              const year = cells[0]?.textContent?.trim();
              const make = cells[1]?.textContent?.trim();
              const model = cells[2]?.textContent?.trim();
              if (year && make && model && /^\d{4}$/.test(year)) {
                results.push({ year, make, model, row: cells[3]?.textContent?.trim() || null });
              }
            }
          });
          if (results.length > 0) return results;

          // Try text pattern matching on any element
          const seen = new Set();
          document.querySelectorAll('a, div, li, tr, article, [class*="vehicle"], [class*="inventory"]').forEach(el => {
            const text = (el.textContent || '').trim();
            if (text.length < 10 || text.length > 200) return;
            const match = text.match(/\b((?:19|20)\d{2})\s+(Acura|Audi|BMW|Buick|Cadillac|Chevrolet|Chevy|Chrysler|Dodge|Fiat|Ford|Genesis|GMC|Honda|Hyundai|Infiniti|Jaguar|Jeep|Kia|Lexus|Lincoln|Mazda|Mercedes|Mercury|Mini|Mitsubishi|Nissan|Pontiac|Porsche|Ram|Saturn|Scion|Subaru|Tesla|Toyota|Volkswagen|VW|Volvo)\s+([A-Za-z0-9][A-Za-z0-9 \-]{1,30})/i);
            if (match) {
              const key = `${match[1]}|${match[2]}|${match[3].trim()}`;
              if (!seen.has(key)) {
                seen.add(key);
                results.push({ year: match[1], make: match[2].trim(), model: match[3].trim().replace(/\s+(Row|Color).*$/i, '') });
              }
            }
          });
          if (results.length > 0) return results;

          // Try __NEXT_DATA__
          const nd = document.getElementById('__NEXT_DATA__');
          if (nd) {
            try {
              const data = JSON.parse(nd.textContent);
              const walk = (obj, d) => {
                if (d > 5 || !obj) return;
                if (Array.isArray(obj)) {
                  for (const item of obj) {
                    if (item?.year && item?.make) {
                      results.push({ year: String(item.year), make: String(item.make), model: String(item.model || '') });
                    }
                  }
                }
                if (typeof obj === 'object') { for (const v of Object.values(obj)) walk(v, d + 1); }
              };
              walk(data, 0);
            } catch (e) {}
          }

          return results;
        });

        if (apiVehicles.length > 0) {
          // Got data from API interception — use that
          vehicles.push(...apiVehicles);
          apiVehicles.length = 0;
          hasMore = false; // API likely returned all data
        } else if (pageVehicles.length === 0) {
          if (pageNum === 1) {
            const title = await page.title();
            const bodySnippet = await page.evaluate(() => document.body?.innerText?.slice(0, 400) || '');
            this.log.warn({ title, bodySnippet: bodySnippet.slice(0, 300) }, 'Page 1 empty — likely blocked by CF');
          }
          hasMore = false;
        } else {
          vehicles.push(...pageVehicles);
          const hasNext = await page.evaluate(() =>
            !!(document.querySelector('a[rel="next"], [class*="next"]:not([class*="disabled"]), [aria-label="Next"]'))
          );
          if (!hasNext) hasMore = false;
          pageNum++;
          await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
        }
      }
    } finally {
      await browser.close();
    }

    this.log.info({ count: vehicles.length, location: location.name }, 'Puppeteer-stealth complete');
    return vehicles;
  }

  /**
   * Axios fallback — plain HTTP. Usually blocked by CloudFlare but cheap to try.
   */
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
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0',
          },
          maxRedirects: 5,
        });

        const $ = cheerio.load(response.data);
        const pageVehicles = [];

        // Try __NEXT_DATA__ SSR payload
        const nextDataScript = $('#__NEXT_DATA__').html();
        if (nextDataScript) {
          try {
            const data = JSON.parse(nextDataScript);
            const extracted = this.extractFromApiResponse(data);
            if (extracted.length > 0) {
              vehicles.push(...extracted);
              this.log.info({ count: extracted.length }, 'Extracted from __NEXT_DATA__');
              return vehicles; // SSR data has everything
            }
          } catch (e) { /* ignore */ }
        }

        // Try data attributes
        $('[data-year]').each((i, el) => {
          const year = $(el).attr('data-year');
          const make = $(el).attr('data-make');
          const model = $(el).attr('data-model');
          if (year && make && model && /^\d{4}$/.test(year)) {
            pageVehicles.push({ year, make, model, row: $(el).attr('data-row') || null });
          }
        });

        // Try table rows
        if (pageVehicles.length === 0) {
          $('table tbody tr, table tr').each((i, el) => {
            const cells = $(el).find('td');
            const year = $(cells[0]).text().trim();
            const make = $(cells[1]).text().trim();
            const model = $(cells[2]).text().trim();
            if (year && make && model && /^\d{4}$/.test(year)) {
              pageVehicles.push({ year, make, model, row: $(cells[3]).text().trim() || null });
            }
          });
        }

        // Try text pattern matching
        if (pageVehicles.length === 0) {
          const bodyText = $('body').text();
          const pattern = /\b((?:19|20)\d{2})\s+(Chevrolet|Ford|Dodge|Chrysler|Jeep|Ram|Toyota|Honda|Nissan|BMW|GMC|Hyundai|Kia|Subaru|Mazda|Volkswagen|Mercedes|Lexus|Acura|Infiniti|Buick|Cadillac|Lincoln|Volvo|Audi|Mini|Pontiac|Saturn|Mitsubishi|Mercury|Scion)\s+([A-Za-z0-9][A-Za-z0-9 \-]{1,30})/gi;
          let match;
          const seen = new Set();
          while ((match = pattern.exec(bodyText)) !== null) {
            const key = `${match[1]}|${match[2]}|${match[3].trim()}`;
            if (!seen.has(key)) {
              seen.add(key);
              pageVehicles.push({ year: match[1], make: match[2].trim(), model: match[3].trim() });
            }
          }
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
