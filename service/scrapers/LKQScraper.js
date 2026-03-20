'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const { v4: uuidv4 } = require('uuid');
const cheerio = require('cheerio');
const axios = require('axios');

/**
 * LKQ Pick Your Part Scraper — HTML Scraper (no browser needed)
 *
 * The pyp.com inventory pages are server-rendered HTML (DotNetNuke CMS).
 * There is NO JSON API — the getVehicleInventory.aspx endpoint returns 404.
 * Vehicle data is embedded in the HTML in div.pypvi_resultRow elements.
 *
 * Page URL pattern:
 *   https://www.pyp.com/inventory/{slug}/?page={N}
 *
 * Verified store slugs (confirmed 2026-03-18):
 *   Raleigh:    raleigh-1168    (storeId 1168)
 *   Durham:     durham-1142     (storeId 1142)
 *   Greensboro: greensboro-1226 (storeId 1226)
 *   East NC:    east-nc-1227    (storeId 1227)
 *
 * HTML structure per vehicle:
 *   <div class="pypvi_resultRow" id="1168-62348">
 *     <a class="pypvi_ymm" href="...">2004&nbsp;<wbr>TOYOTA&nbsp;<wbr>RAV4</a>
 *     <div class="pypvi_detailItem"><b>Color: </b>Black</div>
 *     <div class="pypvi_detailItem"><b>VIN: </b>JTEGD20V840030259</div>
 *     <div class="pypvi_detailItem"><b>Section: </b>CARS &nbsp;&nbsp; <b>Row: </b>B16</div>
 *     <div class="pypvi_detailItem"><b>Stock #:</b> 1168-62348</div>
 *     <div class="pypvi_detailItem"><b>Available:</b> <time datetime="...">3/18/2026</time></div>
 *
 * Pagination: "Next Page" link present when more pages exist.
 * ~25 vehicles per page. Stop when no vehicles with id= found.
 *
 * No Puppeteer, Playwright, or browser automation needed.
 * Uses axios + cheerio only.
 */
class LKQScraper {
  constructor() {
    this.log = log.child({ class: 'LKQScraper' }, true);
    this.locations = [
      // North Carolina
      { name: 'LKQ Raleigh',    slug: 'raleigh-1168',    storeId: '1168' },
      { name: 'LKQ Durham',     slug: 'durham-1142',     storeId: '1142' },
      { name: 'LKQ Greensboro', slug: 'greensboro-1226', storeId: '1226' },
      { name: 'LKQ East NC',    slug: 'east-nc-1227',    storeId: '1227' },
      // Florida
      { name: 'LKQ Tampa',      slug: 'tampa-1180',      storeId: '1180' },
      { name: 'LKQ Largo',      slug: 'largo-1189',      storeId: '1189' },
      { name: 'LKQ Clearwater', slug: 'clearwater-1190', storeId: '1190' },
    ];
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
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
    this.log.info({ location: location.name, slug: location.slug }, 'Scraping ' + location.name);
    const yard = await database('yard').where('name', location.name).first();
    if (!yard) return { location: location.name, success: false, error: 'Yard not in database' };

    const vehicles = await this.fetchAllPages(location);
    if (!vehicles || vehicles.length === 0) {
      this.log.warn({ location: location.name }, 'No vehicles returned');
      return { location: location.name, success: true, count: 0 };
    }

    const now = new Date();

    // Step 1: Mark ALL vehicles for this yard as inactive (not seen this scrape).
    // Vehicles confirmed present below get re-activated with updated last_seen.
    await database('yard_vehicle').where('yard_id', yard.id).where('active', true)
      .update({ active: false, updatedAt: now });

    let inserted = 0, updated = 0;
    for (const v of vehicles) {
      try {
        // Match on year+make+model within this yard
        const existing = await database('yard_vehicle')
          .where('yard_id', yard.id).where('year', v.year)
          .where('make', v.make).where('model', v.model).first();
        if (existing) {
          const upd = {
            trim: v.trim || existing.trim, color: v.color || existing.color,
            row_number: v.row || existing.row_number,
            date_added: v.dateAdded || existing.date_added, active: true,
            last_seen: now, scraped_at: now, updatedAt: now,
          };
          // Preserve VIN and stock_number if already set, update if new
          if (v.vin && v.vin.length >= 11) upd.vin = v.vin;
          if (v.stockNumber) upd.stock_number = v.stockNumber;
          await database('yard_vehicle').where('id', existing.id).update(upd);
          updated++;
        } else {
          await database('yard_vehicle').insert({
            id: uuidv4(), yard_id: yard.id, year: v.year, make: v.make, model: v.model,
            trim: v.trim || null, color: v.color || null, row_number: v.row || null,
            vin: v.vin || null, stock_number: v.stockNumber || null,
            date_added: v.dateAdded || null,
            active: true, first_seen: now, last_seen: now,
            scraped_at: now, createdAt: now, updatedAt: now,
          });
          inserted++;
        }
      } catch (err) {
        this.log.warn({ err: err.message }, 'Insert failed');
      }
    }

    // Step 2: Vehicles not seen this scrape already have active=false from step 1.
    // Their last_seen stays unchanged so we know when they were last confirmed.
    // Vehicles older than 7 days are excluded by the attack list query.

    await database('yard').where('id', yard.id).update({ last_scraped: now, updatedAt: now });
    this.log.info({ location: location.name, total: vehicles.length, inserted, updated }, 'Complete');

    // Decode VINs in background (non-blocking)
    try {
      const VinDecodeService = require('../services/VinDecodeService');
      const vinService = new VinDecodeService();
      vinService.decodeAllUndecoded().catch(err => {
        this.log.warn({ err: err.message }, 'VIN decode batch failed');
      });
    } catch (e) { /* ignore */ }

    return { location: location.name, success: true, total: vehicles.length, inserted, updated };
  }

  /**
   * Fetch and parse all pages of inventory for a location.
   */
  async fetchAllPages(location) {
    const allVehicles = [];
    let page = 1;

    while (page <= 100) {
      const url = page === 1
        ? `https://www.pyp.com/inventory/${location.slug}/`
        : `https://www.pyp.com/inventory/${location.slug}/?page=${page}`;

      try {
        // Use curl subprocess to bypass CloudFlare TLS fingerprinting
        // Node.js axios/fetch gets 403 from CF but curl passes
        const html = await this.fetchWithCurl(url);
        const vehicles = this.parseInventoryPage(html);

        if (vehicles.length === 0) {
          this.log.debug({ page }, 'No vehicles on page — done');
          break;
        }

        allVehicles.push(...vehicles);
        this.log.info({ page, count: vehicles.length, location: location.name }, 'Page scraped');

        // Check for "Next Page" link
        const hasNext = html.includes('Next Page');
        if (!hasNext) break;

        page++;
        // 500ms delay between requests
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        this.log.error({ err: err.message, page, location: location.name }, 'Fetch failed');
        break;
      }
    }

    this.log.info({ total: allVehicles.length, location: location.name, pages: page }, 'All pages fetched');
    return allVehicles;
  }

  /**
   * Fetch a URL using curl subprocess to bypass CloudFlare TLS fingerprinting.
   * Node.js HTTP clients (axios, fetch, undici) get 403 from CloudFlare because
   * their TLS fingerprint is flagged as bot traffic. curl uses OpenSSL which passes.
   */
  fetchWithCurl(url) {
    const { execSync } = require('child_process');
    const cmd = `curl -s -L --max-time 30 -H "User-Agent: ${this.userAgent}" -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8" -H "Accept-Language: en-US,en;q=0.9" -H "Referer: https://www.lkqpickyourpart.com/" -H "sec-ch-ua: \\"Chromium\\";v=\\"131\\", \\"Not_A Brand\\";v=\\"24\\"" -H "sec-ch-ua-mobile: ?0" -H "sec-ch-ua-platform: \\"Windows\\"" -H "Sec-Fetch-Dest: document" -H "Sec-Fetch-Mode: navigate" -H "Sec-Fetch-Site: same-origin" "${url}"`;
    try {
      const result = execSync(cmd, { maxBuffer: 10 * 1024 * 1024, encoding: 'utf-8' });
      if (result.includes('Just a moment') || result.includes('cf-challenge')) {
        throw new Error('CloudFlare challenge page returned');
      }
      return result;
    } catch (err) {
      this.log.warn({ err: err.message?.substring(0, 100), url }, 'curl fetch failed');
      throw err;
    }
  }

  /**
   * Parse vehicle data from a single inventory HTML page.
   * Extracts from div.pypvi_resultRow elements that have an id (real vehicles).
   */
  parseInventoryPage(html) {
    const $ = cheerio.load(html);
    const vehicles = [];

    // Only select result rows with an id attribute (template row has no id)
    $('div.pypvi_resultRow[id]').each((i, el) => {
      const $row = $(el);

      // Year Make Model from the pypvi_ymm link text
      // Format: "2004&nbsp;TOYOTA&nbsp;RAV4" — cheerio converts &nbsp; to spaces
      const ymmText = $row.find('.pypvi_ymm').text().replace(/\s+/g, ' ').trim();
      const ymmMatch = ymmText.match(/^(\d{4})\s+(.+?)\s+(.+)$/);
      if (!ymmMatch) return;

      const year = ymmMatch[1];
      const make = ymmMatch[2].trim();
      const model = ymmMatch[3].trim();

      // Parse detail items
      let color = null, vin = null, row = null, stockNumber = null, dateAdded = null, section = null;

      $row.find('.pypvi_detailItem').each((j, detail) => {
        const text = $(detail).text().replace(/\s+/g, ' ').trim();

        if (text.startsWith('Color:')) {
          color = text.replace('Color:', '').trim();
        } else if (text.startsWith('VIN:')) {
          vin = text.replace('VIN:', '').trim();
        } else if (text.includes('Row:')) {
          const rowMatch = text.match(/Row:\s*(\S+)/);
          if (rowMatch) row = rowMatch[1];
          const sectionMatch = text.match(/Section:\s*(\S+)/);
          if (sectionMatch) section = sectionMatch[1];
        } else if (text.includes('Stock #:') || text.includes('Stock#:')) {
          stockNumber = text.replace(/Stock\s*#:\s*/, '').trim();
        } else if (text.includes('Available:')) {
          const timeEl = $(detail).find('time');
          if (timeEl.length) {
            dateAdded = timeEl.attr('datetime') || timeEl.text().trim();
          } else {
            dateAdded = text.replace('Available:', '').trim();
          }
        }
      });

      vehicles.push({ year, make, model, color, vin, row, stockNumber, dateAdded });
    });

    return vehicles;
  }
}

module.exports = LKQScraper;
