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
 * Returns JSON array of vehicle objects.
 */
class LKQScraper {
  constructor() {
    this.log = log.child({ class: 'LKQScraper' }, true);
    this.locations = [
      { name: 'LKQ Raleigh',    storeId: '1226' },
      { name: 'LKQ Durham',     storeId: '1227' },
      { name: 'LKQ Greensboro', storeId: '1228' },
      { name: 'LKQ East NC',    storeId: '1229' },
    ];
    this.baseUrl = 'https://www.pyp.com/getVehicleInventory.aspx';
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
   * Fetch all inventory pages from the PYP API for a location.
   */
  async fetchInventory(location) {
    const allVehicles = [];
    let page = 1;

    while (page <= 100) {
      const url = `${this.baseUrl}?page=${page}&filter=&store=${location.storeId}`;
      this.log.debug({ url, page }, 'Fetching inventory page');

      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': this.userAgent,
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.pyp.com/inventory/',
          },
        });

        if (!response.ok) {
          this.log.warn({ status: response.status, page }, 'API returned non-OK status');
          break;
        }

        const data = await response.json();

        // Stop when response is empty array or not an array
        if (!Array.isArray(data) || data.length === 0) {
          this.log.debug({ page }, 'Empty page — done');
          break;
        }

        const parsed = data.map(item => this.parseVehicle(item)).filter(Boolean);
        allVehicles.push(...parsed);
        this.log.debug({ page, count: parsed.length }, 'Page parsed');

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
   * Handles various field name conventions the API might use.
   */
  parseVehicle(item) {
    if (!item || typeof item !== 'object') return null;

    const year = String(
      item.year || item.Year || item.vehicleYear || item.vehicle_year || ''
    ).trim();
    const make = String(
      item.make || item.Make || item.vehicleMake || item.vehicle_make || ''
    ).trim();
    const model = String(
      item.model || item.Model || item.vehicleModel || item.vehicle_model || ''
    ).trim();

    if (!year || !make || !model || !/^\d{4}$/.test(year)) return null;

    return {
      year,
      make,
      model,
      trim: item.trim || item.Trim || item.subModel || item.sub_model || null,
      row: item.row || item.Row || item.rowNumber || item.row_number ||
           item.location || item.Location || item.aisle || null,
      color: item.color || item.Color || item.exteriorColor || item.exterior_color || null,
      vin: item.vin || item.VIN || item.vinNumber || null,
      dateAdded: item.dateAdded || item.date_added || item.arrivalDate ||
                 item.arrival_date || item.DateAdded || item.ArrivalDate || null,
      stockNumber: item.stockNumber || item.stock_number || item.StockNumber || null,
    };
  }
}

module.exports = LKQScraper;
