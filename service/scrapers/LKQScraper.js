'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const { v4: uuidv4 } = require('uuid');

/**
 * LKQ Pick Your Part Scraper — Direct API
 *
 * Uses the pyp.com getVehicleInventory.aspx JSON endpoint directly.
 * No browser automation needed.
 *
 * Endpoint: https://www.pyp.com/getVehicleInventory.aspx?page=PAGE&filter=&store=STOREID
 *
 * Verified store IDs (from browser DevTools 2026-03-18):
 *   Raleigh:    1168  (inventory slug: raleigh-1168)
 *   Durham:     1142  (inventory slug: durham-1142)
 *   Greensboro: 1226  (inventory slug: greensboro-1226)
 *   East NC:    1227  (inventory slug: east-nc-1227)
 */
class LKQScraper {
  constructor() {
    this.log = log.child({ class: 'LKQScraper' }, true);
    this.locations = [
      { name: 'LKQ Raleigh',    storeId: '1168', slug: 'raleigh-1168'    },
      { name: 'LKQ Durham',     storeId: '1142', slug: 'durham-1142'     },
      { name: 'LKQ Greensboro', storeId: '1226', slug: 'greensboro-1226' },
      { name: 'LKQ East NC',    storeId: '1227', slug: 'east-nc-1227'    },
    ];
    this.baseUrl = 'https://www.pyp.com/getVehicleInventory.aspx';
    // Flag: set to true to log the first raw API response for debugging field names
    this._debugFirstResponse = true;
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
    this.log.info({ location: location.name, storeId: location.storeId }, 'Scraping ' + location.name);
    const yard = await database('yard').where('name', location.name).first();
    if (!yard) return { location: location.name, success: false, error: 'Yard not in database' };

    const vehicles = await this.fetchInventory(location);
    if (!vehicles || vehicles.length === 0) {
      this.log.warn({ location: location.name }, 'No vehicles returned');
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
    this.log.info({ location: location.name, total: vehicles.length, inserted, updated }, 'Complete');
    return { location: location.name, success: true, total: vehicles.length, inserted, updated };
  }

  /**
   * Build headers that mimic a real browser XHR from the inventory page.
   * The API checks Referer + X-Requested-With to block direct calls.
   */
  buildHeaders(location) {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': `https://www.pyp.com/inventory/${location.slug}/`,
      'Origin': 'https://www.pyp.com',
      'X-Requested-With': 'XMLHttpRequest',
    };
  }

  /**
   * Fetch all inventory pages from the PYP API for a location.
   */
  async fetchInventory(location) {
    const allVehicles = [];
    let page = 1;
    const headers = this.buildHeaders(location);

    while (page <= 100) {
      const url = `${this.baseUrl}?page=${page}&filter=&store=${location.storeId}`;
      this.log.debug({ url, page }, 'Fetching inventory page');

      try {
        const response = await fetch(url, { headers });

        if (!response.ok) {
          this.log.warn({ status: response.status, page, store: location.storeId }, 'API returned non-OK status');
          break;
        }

        const rawText = await response.text();

        // DEBUG: Log the raw response for the first page of the first location
        if (this._debugFirstResponse && page === 1) {
          this._debugFirstResponse = false;
          // Log first 2000 chars of raw response so we can see field names
          this.log.info({
            location: location.name,
            storeId: location.storeId,
            rawResponseLength: rawText.length,
            rawResponsePreview: rawText.slice(0, 2000),
          }, 'DEBUG: Raw API response for first page');
        }

        let data;
        try {
          data = JSON.parse(rawText);
        } catch (parseErr) {
          this.log.warn({
            page,
            rawPreview: rawText.slice(0, 500),
          }, 'Response is not valid JSON');
          break;
        }

        // Handle both array and object-with-array responses
        let vehicles = [];
        if (Array.isArray(data)) {
          vehicles = data;
        } else if (data && typeof data === 'object') {
          // The API might wrap results in an object — find the array
          for (const val of Object.values(data)) {
            if (Array.isArray(val) && val.length > 0) {
              vehicles = val;
              break;
            }
          }
          // Also log the top-level keys so we understand the structure
          if (page === 1) {
            this.log.info({ topLevelKeys: Object.keys(data), location: location.name },
              'API response is an object, not an array');
          }
        }

        if (vehicles.length === 0) {
          this.log.debug({ page }, 'Empty page — done');
          break;
        }

        const parsed = vehicles.map(item => this.parseVehicle(item)).filter(Boolean);
        allVehicles.push(...parsed);
        this.log.info({ page, raw: vehicles.length, parsed: parsed.length, location: location.name }, 'Page parsed');

        page++;
        // 500ms delay between requests
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        this.log.error({ err: err.message, page }, 'Fetch failed');
        break;
      }
    }

    this.log.info({ total: allVehicles.length, location: location.name, pages: page - 1 }, 'Inventory fetch complete');
    return allVehicles;
  }

  /**
   * Parse a single vehicle object from the API response.
   * Tries every known field name convention — we'll narrow this down
   * once we see the actual API response shape.
   */
  parseVehicle(item) {
    if (!item || typeof item !== 'object') return null;

    const year = String(
      item.year || item.Year || item.vehicleYear || item.vehicle_year ||
      item.VehicleYear || item.yr || ''
    ).trim();
    const make = String(
      item.make || item.Make || item.vehicleMake || item.vehicle_make ||
      item.VehicleMake || item.mk || ''
    ).trim();
    const model = String(
      item.model || item.Model || item.vehicleModel || item.vehicle_model ||
      item.VehicleModel || item.mdl || ''
    ).trim();

    if (!year || !make || !model || !/^\d{4}$/.test(year)) return null;

    return {
      year,
      make,
      model,
      trim: item.trim || item.Trim || item.subModel || item.sub_model ||
            item.SubModel || null,
      row: item.row || item.Row || item.rowNumber || item.row_number ||
           item.RowNumber || item.location || item.Location ||
           item.aisle || item.Aisle || null,
      color: item.color || item.Color || item.exteriorColor || item.exterior_color ||
             item.ExteriorColor || null,
      vin: item.vin || item.VIN || item.vinNumber || item.Vin || null,
      dateAdded: item.dateAdded || item.date_added || item.arrivalDate ||
                 item.arrival_date || item.DateAdded || item.ArrivalDate ||
                 item.displayDate || item.DisplayDate || null,
      stockNumber: item.stockNumber || item.stock_number || item.StockNumber ||
                   item.stockNo || item.StockNo || null,
    };
  }
}

module.exports = LKQScraper;
