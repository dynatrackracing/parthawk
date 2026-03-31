/**
 * Vehicle Research Service
 *
 * Scrapes eBay sold items for a vehicle to discover sellable parts.
 * Primary engine: PriceCheckServiceV2 (axios+cheerio, proven, no external dependency)
 * Optional upgrade: Apify actor (if APIFY_TOKEN + APIFY_ACTOR_ID configured)
 *
 * Pipeline:
 *   1. Check 7-day cache in instant_research_cache
 *   2. For each in-scope part type, scrape eBay sold listings
 *   3. Classify, score, extract part numbers
 *   4. Persist: market_demand_cache + instant_research_cache + sky_watch_research
 */

'use strict';

const axios = require('axios');
const { log } = require('../lib/logger');
const { extractPartNumbers } = require('../utils/partIntelligence');
const { database } = require('../database/database');
const { scrapeSoldComps } = require('./PriceCheckServiceV2');

// In-scope part types — modules, amps, sensors (things that unbolt from outside)
const RESEARCH_PART_TYPES = [
  { key: 'ECM', searchTerm: 'ECM' },
  { key: 'BCM', searchTerm: 'BCM' },
  { key: 'TCM', searchTerm: 'TCM' },
  { key: 'ABS', searchTerm: 'ABS module' },
  { key: 'TIPM', searchTerm: 'TIPM fuse box' },
  { key: 'AMP', searchTerm: 'amplifier' },
  { key: 'CLUSTER', searchTerm: 'instrument cluster' },
  { key: 'RADIO', searchTerm: 'radio' },
  { key: 'HVAC', searchTerm: 'HVAC module' },
  { key: 'AIRBAG', searchTerm: 'airbag module' },
  { key: 'CAMERA', searchTerm: 'backup camera' },
  { key: 'STEERING', searchTerm: 'steering module' },
  { key: 'THROTTLE', searchTerm: 'throttle body' },
  { key: 'LIFTGATE', searchTerm: 'liftgate module' },
  { key: 'TURBO', searchTerm: 'turbocharger' },
  { key: 'ALTERNATOR', searchTerm: 'alternator' },
];

// High-priority parts get searched first (most likely to have value)
const HIGH_PRIORITY = ['ECM', 'BCM', 'TCM', 'ABS', 'TIPM', 'AMP', 'CLUSTER'];

class ApifyResearchService {
  constructor() {
    this.log = log.child({ class: 'ApifyResearchService' });
    this._running = false;
  }

  async researchVehicle(vehicle, options = {}) {
    if (this._running) throw new Error('Research already running — please wait');

    // Check 7-day cache first
    const cacheKey = `research|${vehicle.year}|${vehicle.make}|${vehicle.model}|${vehicle.engine || 'any'}`.toLowerCase();
    try {
      const cached = await database('instant_research_cache')
        .where('vehicle_key', cacheKey)
        .whereRaw("last_updated > NOW() - INTERVAL '7 days'")
        .first();
      if (cached && cached.results) {
        const r = typeof cached.results === 'string' ? JSON.parse(cached.results) : cached.results;
        if (r.parts && r.parts.length > 0) {
          return { ...r, cached: true, cacheKey, dataSource: 'cache' };
        }
      }
    } catch (e) { /* cache miss */ }

    this._running = true;
    const startTime = Date.now();

    try {
      const useApify = process.env.APIFY_TOKEN && process.env.APIFY_ACTOR_ID;
      const baseQuery = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;

      let allItems;
      if (useApify) {
        allItems = await this._scrapeViaApify(baseQuery, vehicle);
      } else {
        allItems = await this._scrapeViaPriceCheck(baseQuery, vehicle);
      }

      // Classify each item by part type
      const byPartType = {};
      for (const item of allItems) {
        const pt = this._detectPartType(item.title);
        if (!pt) continue;
        if (!byPartType[pt]) byPartType[pt] = [];
        byPartType[pt].push(item);
      }

      // Build results per part type
      const parts = [];
      for (const [partType, items] of Object.entries(byPartType)) {
        const prices = items.map(i => i.price).filter(p => p > 0);
        if (prices.length === 0) continue;

        const avgSoldPrice = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
        const soldCount = items.length;
        const sampleTitles = items.slice(0, 5).map(i => i.title);
        const partNumbers = [];
        for (const item of items) {
          const pns = extractPartNumbers(item.title);
          for (const pn of pns) {
            if (pn.base && !partNumbers.includes(pn.base)) partNumbers.push(pn.base);
          }
        }

        let valueTier = 'LOW';
        if (avgSoldPrice >= 150 && soldCount >= 3) valueTier = 'HIGH';
        else if (avgSoldPrice >= 75 || soldCount >= 2) valueTier = 'MEDIUM';

        parts.push({
          partType, soldCount, avgSoldPrice,
          minPrice: Math.round(Math.min(...prices)),
          maxPrice: Math.round(Math.max(...prices)),
          sampleTitles,
          partNumbers: partNumbers.slice(0, 5),
          lastSoldDate: items[0]?.date || null,
          valueTier,
        });
      }

      parts.sort((a, b) => {
        const tierOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
        const td = (tierOrder[a.valueTier] || 2) - (tierOrder[b.valueTier] || 2);
        if (td !== 0) return td;
        return b.avgSoldPrice - a.avgSoldPrice;
      });

      const summary = {
        totalEstimatedValue: parts.reduce((s, p) => s + p.avgSoldPrice, 0),
        partsFoundCount: parts.length,
        highValueCount: parts.filter(p => p.valueTier === 'HIGH').length,
        mediumValueCount: parts.filter(p => p.valueTier === 'MEDIUM').length,
        lowValueCount: parts.filter(p => p.valueTier === 'LOW').length,
      };

      const result = {
        vehicle, parts, summary,
        dataSource: useApify ? 'apify' : 'ebay_scrape',
        elapsed: Date.now() - startTime,
      };

      // Persist: market_demand_cache
      await this._enrichMarketCache(parts);

      // Persist: instant_research_cache
      try {
        await database('instant_research_cache')
          .insert({ vehicle_key: cacheKey, results: JSON.stringify(result), last_updated: new Date() })
          .onConflict('vehicle_key')
          .merge({ results: JSON.stringify(result), last_updated: new Date() });
      } catch (e) { this.log.warn({ err: e.message }, 'Failed to cache research'); }

      // Persist: sky_watch_research
      await this._saveToSkyWatch(vehicle, result, options);

      this.log.info({
        vehicle: baseQuery, partsFound: parts.length, highValue: summary.highValueCount,
        dataSource: result.dataSource, elapsed: result.elapsed,
      }, 'Vehicle research complete');

      return { ...result, cached: false, cacheKey };
    } finally {
      this._running = false;
    }
  }

  // ── Primary engine: PriceCheckServiceV2 (axios+cheerio) ──────────

  async _scrapeViaPriceCheck(baseQuery, vehicle) {
    const allItems = [];

    // Search high-priority part types first, then the rest
    const ordered = [
      ...HIGH_PRIORITY.map(k => RESEARCH_PART_TYPES.find(p => p.key === k)).filter(Boolean),
      ...RESEARCH_PART_TYPES.filter(p => !HIGH_PRIORITY.includes(p.key)),
    ];

    for (const pt of ordered) {
      const query = `${baseQuery} ${pt.searchTerm}`;
      try {
        this.log.info({ query }, 'Scraping eBay sold comps');
        const items = await scrapeSoldComps(query, 1);
        for (const item of items) {
          allItems.push({
            title: item.title || '',
            price: parseFloat(item.price) || 0,
            date: item.soldDate || null,
          });
        }
      } catch (e) {
        this.log.warn({ query, err: e.message }, 'Scrape failed for part type');
      }
      // Rate limit: 2-4s between searches to avoid eBay blocking
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
    }

    // Engine-specific search for ECM/TCM if engine data available
    if (vehicle.engine) {
      const engineParts = ['ECM', 'TCM'];
      for (const ptKey of engineParts) {
        const pt = RESEARCH_PART_TYPES.find(p => p.key === ptKey);
        if (!pt) continue;
        const query = `${baseQuery} ${vehicle.engine} ${pt.searchTerm}`;
        try {
          const items = await scrapeSoldComps(query, 1);
          for (const item of items) {
            allItems.push({
              title: item.title || '',
              price: parseFloat(item.price) || 0,
              date: item.soldDate || null,
            });
          }
        } catch (e) { /* engine-specific search is best-effort */ }
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
      }
    }

    return this._deduplicateItems(allItems);
  }

  // ── Optional upgrade: Apify actor ────────────────────────────────

  async _scrapeViaApify(baseQuery, vehicle) {
    const token = process.env.APIFY_TOKEN;
    const actorId = process.env.APIFY_ACTOR_ID;
    const allItems = [];

    // Generic broad search
    const genericItems = await this._runApifyActor(
      `${baseQuery} OEM module`, token, actorId, 120
    );
    allItems.push(...genericItems);

    // Engine-specific search
    if (vehicle.engine) {
      const specificItems = await this._runApifyActor(
        `${baseQuery} ${vehicle.engine} OEM`, token, actorId, 80
      );
      allItems.push(...specificItems);
    }

    // Targeted searches for high-priority parts
    for (const ptKey of HIGH_PRIORITY) {
      const pt = RESEARCH_PART_TYPES.find(p => p.key === ptKey);
      if (!pt) continue;
      try {
        const items = await this._runApifyActor(
          `${baseQuery} ${pt.searchTerm}`, token, actorId, 30
        );
        allItems.push(...items);
      } catch (e) {
        this.log.warn({ pt: ptKey, err: e.message }, 'Apify part search failed');
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    return this._deduplicateItems(allItems);
  }

  async _runApifyActor(query, token, actorId, maxItems = 48) {
    const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${token}&timeout=120`;
    this.log.info({ query, maxItems, actorId }, 'Running Apify actor');

    const response = await axios.post(url, {
      search: query,
      categoryId: '6030',
      maxItems,
      sold: true,
    }, { timeout: 130000 });

    const items = response.data || [];
    return items.map(item => ({
      title: item.title || '',
      price: this._parsePrice(item.price),
      date: item.date || item.soldDate || null,
    }));
  }

  // ── Shared helpers ───────────────────────────────────────────────

  _parsePrice(priceStr) {
    if (typeof priceStr === 'number') return priceStr;
    if (!priceStr) return 0;
    return parseFloat(String(priceStr).replace(/[^0-9.]/g, '')) || 0;
  }

  _deduplicateItems(items) {
    const seen = new Set();
    return items.filter(item => {
      const key = (item.title || '').toLowerCase().substring(0, 80);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  _detectPartType(title) {
    if (!title) return null;
    const t = title.toLowerCase();
    if (/\bcomplete\s+(engine|motor|transmission)\b/i.test(t)) return null;
    if (/\b(door|fender|hood|bumper|quarter\s*panel|glass|wheel|tire|seat|dashboard)\b/i.test(t)) return null;

    const TYPE_MAP = {
      ECM: /\b(ecm|pcm|ecu|engine\s*control|engine\s*computer)\b/i,
      TCM: /\b(tcm|tcu|transmission\s*control)\b/i,
      BCM: /\b(bcm|body\s*control)\b/i,
      ABS: /\b(abs|anti.?lock|brake\s*(pump|module))\b/i,
      TIPM: /\b(tipm|fuse\s*box|junction|power\s*distribution|ipdm)\b/i,
      AMP: /\b(amp|amplifier|bose|harman|alpine|jbl|infinity)\b/i,
      CLUSTER: /\b(cluster|speedometer|gauge|instrument)\b/i,
      RADIO: /\b(radio|head\s*unit|infotainment|stereo|navigation)\b/i,
      HVAC: /\b(hvac|climate\s*control|heater\s*control)\b/i,
      AIRBAG: /\b(airbag|srs)\s*(module|sensor)?\b/i,
      CAMERA: /\b(camera|backup\s*cam|surround\s*view)\b/i,
      STEERING: /\b(steering\s*(module|control)|eps\s*module|power\s*steering\s*pump)\b/i,
      THROTTLE: /\b(throttle\s*body)\b/i,
      LIFTGATE: /\b(liftgate|tailgate)\s*(module|motor|control)\b/i,
      BLIND_SPOT: /\b(blind\s*spot|parking\s*sensor|park\s*assist)\b/i,
      TURBO: /\b(turbo(charger)?|supercharger)\b/i,
      ALTERNATOR: /\b(alternator)\b/i,
      INTAKE: /\b(intake\s*manifold)\b/i,
    };

    for (const [type, re] of Object.entries(TYPE_MAP)) {
      if (re.test(t)) return type;
    }
    return null;
  }

  async _enrichMarketCache(parts) {
    for (const part of parts) {
      if (!part.partNumbers || part.partNumbers.length === 0) continue;
      for (const pn of part.partNumbers) {
        try {
          await database('market_demand_cache')
            .insert({
              part_number_base: pn,
              ebay_sold_90d: part.soldCount,
              ebay_avg_price: part.avgSoldPrice,
              ebay_active_listings: 0,
              market_score: part.valueTier === 'HIGH' ? 90 : part.valueTier === 'MEDIUM' ? 60 : 30,
              last_updated: new Date(),
              createdAt: new Date(),
            })
            .onConflict('part_number_base')
            .merge({
              ebay_sold_90d: part.soldCount,
              ebay_avg_price: part.avgSoldPrice,
              market_score: part.valueTier === 'HIGH' ? 90 : part.valueTier === 'MEDIUM' ? 60 : 30,
              last_updated: new Date(),
            });
        } catch (e) { /* skip individual PN failures */ }
      }
    }
  }

  async _saveToSkyWatch(vehicle, result, options) {
    if (result.summary.highValueCount < 1 && result.summary.partsFoundCount < 3) return;

    try {
      await database('sky_watch_research')
        .insert({
          vehicle_year: vehicle.year,
          vehicle_make: vehicle.make,
          vehicle_model: vehicle.model,
          vehicle_engine: vehicle.engine || null,
          vehicle_trim: vehicle.trim || null,
          source: options.source || 'STANDALONE',
          source_vin: options.vin || null,
          results: JSON.stringify(result.parts),
          total_estimated_value: result.summary.totalEstimatedValue,
          parts_found_count: result.summary.partsFoundCount,
          high_value_count: result.summary.highValueCount,
          status: 'new',
          created_at: new Date(),
          updated_at: new Date(),
        })
        .onConflict(['vehicle_year', 'vehicle_make', 'vehicle_model', 'vehicle_engine'])
        .merge({
          results: JSON.stringify(result.parts),
          total_estimated_value: result.summary.totalEstimatedValue,
          parts_found_count: result.summary.partsFoundCount,
          high_value_count: result.summary.highValueCount,
          status: 'new',
          updated_at: new Date(),
        });
    } catch (e) {
      this.log.warn({ err: e.message }, 'Failed to save to sky watch');
    }
  }
}

module.exports = ApifyResearchService;
