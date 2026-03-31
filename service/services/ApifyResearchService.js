const axios = require('axios');
const { log } = require('../lib/logger');
const { extractPartNumbers } = require('../utils/partIntelligence');
const { database } = require('../database/database');

// In-scope part types for research (modules, amps, sensors — things that unbolt)
const RESEARCH_PART_TYPES = [
  { key: 'ECM', query: 'ECM ECU engine control module' },
  { key: 'BCM', query: 'BCM body control module' },
  { key: 'TCM', query: 'TCM transmission control module' },
  { key: 'ABS', query: 'ABS module pump' },
  { key: 'TIPM', query: 'TIPM fuse box power distribution' },
  { key: 'AMP', query: 'amplifier amp' },
  { key: 'FUSE_BOX', query: 'fuse box junction box' },
  { key: 'HVAC', query: 'HVAC climate control module' },
  { key: 'AIRBAG', query: 'airbag SRS module' },
  { key: 'CLUSTER', query: 'instrument cluster speedometer' },
  { key: 'RADIO', query: 'radio head unit infotainment' },
  { key: 'CAMERA', query: 'backup camera surround camera' },
  { key: 'STEERING', query: 'steering module EPS power steering' },
  { key: 'THROTTLE', query: 'throttle body' },
  { key: 'LIFTGATE', query: 'liftgate module tailgate' },
  { key: 'BLIND_SPOT', query: 'blind spot monitor sensor module' },
  { key: 'TURBO', query: 'turbocharger turbo' },
  { key: 'ALTERNATOR', query: 'alternator' },
  { key: 'INTAKE', query: 'intake manifold' },
];

class ApifyResearchService {
  constructor() {
    this.log = log.child({ class: 'ApifyResearchService' });
    this._running = false; // rate limit lock
  }

  async researchVehicle(vehicle, options = {}) {
    // vehicle: { year, make, model, engine?, trim? }
    // options: { source: 'VIN'|'STANDALONE', vin?: string }

    const APIFY_TOKEN = process.env.APIFY_TOKEN;
    if (!APIFY_TOKEN) throw new Error('APIFY_TOKEN not configured');

    // Rate limit: one at a time
    if (this._running) throw new Error('Research already running — please wait');

    // Check 7-day cache first
    const cacheKey = `${vehicle.year}|${vehicle.make}|${vehicle.model}|${vehicle.engine || 'any'}`.toLowerCase();
    try {
      const cached = await database('instant_research_cache')
        .where('vehicle_key', cacheKey)
        .whereRaw("last_updated > NOW() - INTERVAL '7 days'")
        .first();
      if (cached && cached.results) {
        const r = typeof cached.results === 'string' ? JSON.parse(cached.results) : cached.results;
        return { ...r, cached: true, cacheKey };
      }
    } catch (e) { /* cache miss */ }

    this._running = true;
    try {
      // Build search queries for each part type
      const baseQuery = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
      const specificQuery = vehicle.engine ? `${baseQuery} ${vehicle.engine}` : null;

      // Run Apify searches — batch into one call per search query
      // Each Apify call searches for the base vehicle string, we filter by part type locally
      const genericResults = await this._runApifySearch(
        `${baseQuery} OEM module`, APIFY_TOKEN, 120
      );

      let specificResults = [];
      if (specificQuery) {
        specificResults = await this._runApifySearch(
          `${specificQuery} OEM`, APIFY_TOKEN, 80
        );
      }

      // Also search for high-value specific part types
      const partSearchResults = [];
      const highPriorityParts = ['ECM', 'BCM', 'TCM', 'ABS', 'TIPM', 'AMP'];
      for (const pt of highPriorityParts) {
        const ptDef = RESEARCH_PART_TYPES.find(p => p.key === pt);
        if (!ptDef) continue;
        const shortQuery = ptDef.query.split(' ')[0]; // Just the main keyword
        try {
          const results = await this._runApifySearch(
            `${baseQuery} ${shortQuery}`, APIFY_TOKEN, 30
          );
          partSearchResults.push(...results);
        } catch (e) {
          this.log.warn({ pt, err: e.message }, 'Part-specific search failed');
        }
        // Small delay between searches
        await new Promise(r => setTimeout(r, 2000));
      }

      // Merge all results, deduplicate by title
      const allItems = this._deduplicateItems([...genericResults, ...specificResults, ...partSearchResults]);

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
          partType,
          soldCount,
          avgSoldPrice,
          minPrice: Math.round(Math.min(...prices)),
          maxPrice: Math.round(Math.max(...prices)),
          sampleTitles,
          partNumbers: partNumbers.slice(0, 5),
          lastSoldDate: items[0]?.date || null,
          valueTier,
          engineSpecific: false,
        });
      }

      // Sort: HIGH first, then by price
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

      const result = { vehicle, parts, summary };

      // Persist: market_demand_cache enrichment
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

      this.log.info({ vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`, partsFound: parts.length, highValue: summary.highValueCount }, 'Apify research complete');

      return { ...result, cached: false, cacheKey };
    } finally {
      this._running = false;
    }
  }

  async _runApifySearch(query, token, maxItems = 48) {
    const ACTOR_ID = 'dzbgas~ebay-scraper';
    const url = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${token}&timeout=120`;

    this.log.info({ query, maxItems }, 'Running Apify eBay search');

    const response = await axios.post(url, {
      search: query,
      categoryId: '6030',
      maxItems,
      sold: true,
    }, { timeout: 130000 }); // slightly more than Apify timeout

    const items = response.data || [];
    return items.map(item => ({
      title: item.title || '',
      price: this._parsePrice(item.price),
      url: item.url || item.itemUrl || '',
      date: item.date || item.soldDate || null,
      condition: item.condition || '',
    }));
  }

  _parsePrice(priceStr) {
    if (typeof priceStr === 'number') return priceStr;
    if (!priceStr) return 0;
    const m = String(priceStr).replace(/[^0-9.]/g, '');
    return parseFloat(m) || 0;
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
    // Exclusions first
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
              source: 'apify',
              last_updated: new Date(),
              createdAt: new Date(),
            })
            .onConflict('part_number_base')
            .merge({
              ebay_sold_90d: part.soldCount,
              ebay_avg_price: part.avgSoldPrice,
              market_score: part.valueTier === 'HIGH' ? 90 : part.valueTier === 'MEDIUM' ? 60 : 30,
              source: 'apify',
              last_updated: new Date(),
            });
        } catch (e) { /* skip individual PN failures */ }
      }
    }
  }

  async _saveToSkyWatch(vehicle, result, options) {
    // Only save if 1+ high-value or 3+ parts
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
