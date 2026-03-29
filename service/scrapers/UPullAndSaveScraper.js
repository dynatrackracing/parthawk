'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

/**
 * U Pull & Save / Road Tested Parts Scraper
 * upullandsave.com — WordPress + YardSmart integration.
 * Pure AJAX API (no browser needed). Returns clean JSON with VIN, color, row, stock.
 *
 * API: POST /wp-admin/admin-ajax.php
 *   action=yardsmart_integration
 *   api_call=getInventoryDatatablesArray
 *   params[yard_id]=<id>  params[vehicle_type_id]=793
 *   length=5000 (returns all in one request)
 *
 * YardSmart yard_ids (extracted from page JS):
 *   Hebron KY = 232, Louisville KY = 265, Lexington KY = 595, Savannah TN = 298
 *
 * Rate limiting: API returns 401 if hit too fast. Use 5s delays between locations.
 * Works from datacenter IPs — no residential IP needed.
 */

const YARDSMART_IDS = {
  "Bessler's Hebron KY": { yardId: 232, vehicleTypeId: 793 },
  "Bessler's Louisville KY": { yardId: 265, vehicleTypeId: 793 },
  'Bluegrass Lexington KY': { yardId: 595, vehicleTypeId: 793 },
  'Raceway Savannah TN': { yardId: 298, vehicleTypeId: 793 },
};

class UPullAndSaveScraper {
  constructor() {
    this.log = log.child({ class: 'UPullAndSaveScraper' }, true);
    this.ajaxUrl = 'https://upullandsave.com/wp-admin/admin-ajax.php';
  }

  async scrapeYard(yard) {
    this.log.info({ yard: yard.name }, 'Scraping U Pull & Save: ' + yard.name);

    const config = YARDSMART_IDS[yard.name];
    if (!config) {
      this.log.error({ yard: yard.name }, 'Unknown U Pull & Save location');
      return { location: yard.name, success: false, error: 'Unknown YardSmart ID for ' + yard.name };
    }

    const vehicles = await this.fetchInventory(config.yardId, config.vehicleTypeId, yard.name);
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
        // Match on VIN + yard_id (VINs available from this site)
        let existing = null;
        if (v.vin && v.vin.length >= 11) {
          existing = await database('yard_vehicle')
            .where('yard_id', yard.id).where('vin', v.vin).first();
        }
        // Fallback: match on year+make+model if no VIN
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
            stock_number: v.stockNumber || null,
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
            stock_number: v.stockNumber || null,
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
    this.log.info({ location: yard.name, total: vehicles.length, inserted, updated, deactivated: stillInactive }, 'U Pull & Save scrape complete');
    return { location: yard.name, success: true, total: vehicles.length, inserted, updated, deactivated: stillInactive };
  }

  async fetchInventory(yardSmartId, vehicleTypeId, yardName) {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const params = new URLSearchParams();
        params.append('action', 'yardsmart_integration');
        params.append('api_call', 'getInventoryDatatablesArray');
        params.append('params[yard_id]', String(yardSmartId));
        params.append('params[vehicle_type_id]', String(vehicleTypeId));
        params.append('draw', '1');
        params.append('start', '0');
        params.append('length', '5000');

        this.log.info({ yardSmartId, yardName, attempt }, 'Fetching inventory via YardSmart API');

        const response = await axios.post(this.ajaxUrl, params.toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': 'https://upullandsave.com/',
          },
          timeout: 30000,
        });

        const data = response.data;
        if (!data || !Array.isArray(data.data)) {
          this.log.warn({ yardSmartId }, 'Unexpected API response format');
          return [];
        }

        this.log.info({ yardSmartId, yardName, total: data.recordsTotal, returned: data.data.length }, 'YardSmart API returned');

        return data.data.map(row => {
          const year = parseInt(row.year);
          if (!year || year < 1980 || year > 2030) return null;
          if (!row.make) return null;

          return {
            year,
            make: (row.make || '').toUpperCase().trim(),
            model: (row.model || '').toUpperCase().trim(),
            vin: row.vin && row.vin.length >= 11 ? row.vin.toUpperCase().trim() : null,
            color: row.color || null,
            row: row.yard_row || null,
            stockNumber: row.stock_number || null,
            dateAdded: null, // Arrival date not in API response fields we've seen
          };
        }).filter(Boolean);

      } catch (err) {
        if (err.response?.status === 401 && attempt < maxRetries) {
          const delay = attempt * 10000; // 10s, 20s backoff
          this.log.warn({ yardSmartId, attempt, delay }, 'Rate limited (401), retrying after delay');
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        this.log.error({ err: err.message, yardSmartId, attempt }, 'YardSmart API fetch failed');
        return [];
      }
    }
    return [];
  }
}

module.exports = UPullAndSaveScraper;
