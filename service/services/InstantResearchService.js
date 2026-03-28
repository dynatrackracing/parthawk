'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const { extractPartNumbers } = require('../utils/partIntelligence');

const TYPE_RE = {
  ECM: /\b(ecm|pcm|ecu|engine\s*control|engine\s*computer)\b/i,
  TCM: /\b(tcm|tcu|transmission\s*control)\b/i,
  BCM: /\b(bcm|body\s*control)\b/i,
  ABS: /\b(abs|anti.?lock|brake\s*pump|brake\s*module)\b/i,
  TIPM: /\b(tipm|fuse\s*box|junction|fuse\s*relay|ipdm|power\s*distribution)\b/i,
  AMP: /\b(amp|amplifier|bose|harman|alpine|jbl|infinity)\b/i,
  CLUSTER: /\b(cluster|speedometer|gauge|instrument)\b/i,
  RADIO: /\b(radio|head\s*unit|infotainment|stereo|receiver|navigation)\b/i,
  THROTTLE: /\b(throttle\s*body)\b/i,
  STEERING: /\b(steering\s*(module|control)|eps\s*module|power\s*steering)\b/i,
  HVAC: /\b(hvac|climate\s*control|heater\s*control|a\/c\s*control)\b/i,
  AIRBAG: /\b(airbag|srs)\s*(module|sensor)?\b/i,
  CAMERA: /\b(camera|backup\s*cam)\b/i,
  MIRROR: /\b(mirror)\b/i,
  REGULATOR: /\b(window\s*(motor|regulator))\b/i,
  ALTERNATOR: /\b(alternator)\b/i,
  STARTER: /\b(starter)\b/i,
  BLOWER: /\b(blower\s*motor)\b/i,
  SENSOR: /\b(blind\s*spot|parking\s*sensor|park\s*assist)\b/i,
  LIFTGATE: /\b(liftgate|tailgate)\s*(module|motor|control)\b/i,
};

const ENGINE_SPECIFIC = new Set(['ECM', 'PCM', 'TCM', 'THROTTLE']);

function detectPartType(title) {
  if (!title) return null;
  for (const [type, re] of Object.entries(TYPE_RE)) {
    if (re.test(title)) return type;
  }
  return null;
}

function getBadge(price) {
  if (price >= 250) return 'GREAT';
  if (price >= 150) return 'GOOD';
  if (price >= 100) return 'FAIR';
  return 'POOR';
}

/**
 * Extract displacement number from messy engine strings.
 * "5.7L V8 HEMI" → "5.7", "3.5L V6 DOHC 24V" → "3.5", "2.0L Turbo" → "2.0"
 */
function normalizeEngine(eng) {
  if (!eng) return null;
  const m = eng.match(/(\d+\.\d)/);
  return m ? m[1] : null;
}

class InstantResearchService {
  constructor() {
    this.log = log.child({ class: 'InstantResearchService' }, true);
  }

  async researchVehicle({ year, make, model, engine, drivetrain, refresh = false }) {
    const cacheKey = `${year}|${make}|${model}|${engine || 'any'}`.toLowerCase();

    // Check cache (24h) unless refresh requested
    if (!refresh) {
      try {
        const cached = await database('instant_research_cache')
          .where('vehicle_key', cacheKey)
          .whereRaw("last_updated > NOW() - INTERVAL '24 hours'")
          .first();
        if (cached && cached.results) {
          const r = typeof cached.results === 'string' ? JSON.parse(cached.results) : cached.results;
          return { ...r, cached: true };
        }
      } catch (e) { /* cache miss */ }
    }

    // Step 1: Find matching parts via Auto+AIC+Item
    let query = database('Auto')
      .join('AutoItemCompatibility', 'Auto.id', 'AutoItemCompatibility.autoId')
      .join('Item', 'AutoItemCompatibility.itemId', 'Item.id')
      .where('Auto.year', year)
      .whereRaw('UPPER("Auto"."make") = UPPER(?)', [make])
      .where('Item.price', '>', 0)
      .select('Item.title', 'Item.manufacturerPartNumber', 'Item.id as itemId',
              'Item.price', 'Item.partNumberBase', 'Item.seller',
              'Auto.engine as autoEngine', 'Auto.model as autoModel');

    // Word-boundary model match (Cherokee ≠ Grand Cherokee)
    query = query.whereRaw(
      "UPPER(REPLACE(REPLACE(\"Auto\".\"model\", '-', ''), ' ', '')) = UPPER(REPLACE(REPLACE(?, '-', ''), ' ', ''))",
      [model]
    );

    // Engine filter — normalize displacement for fuzzy matching
    const engineDisp = normalizeEngine(engine);
    if (engineDisp) {
      query = query.where(function() {
        this.whereRaw('"Auto"."engine" LIKE ?', [`%${engineDisp}%`])
          .orWhereNull('Auto.engine')
          .orWhere('Auto.engine', '')
          .orWhere('Auto.engine', 'N/A');
      });
    }

    const items = await query.limit(300);
    this.log.info({ year, make, model, engine, itemCount: items.length }, 'Parts found via Auto+AIC');

    // Step 2: Group by part type and deduplicate by partNumberBase
    const partMap = new Map(); // partNumberBase → part data
    for (const item of items) {
      const partType = detectPartType(item.title);
      if (!partType) continue;

      const pns = extractPartNumbers(item.title || '');
      const pnBase = (pns.length > 0 ? pns[0].base : null) || item.partNumberBase || null;
      const key = pnBase || `${partType}_${item.itemId}`;

      if (!partMap.has(key)) {
        partMap.set(key, {
          partType,
          partNumberBase: pnBase,
          title: item.title,
          itemId: item.itemId,
          itemPrice: parseFloat(item.price) || 0,
          seller: item.seller,
          autoEngine: item.autoEngine,
        });
      }
    }

    // Step 3: Get year ranges per part number (batch)
    let yearRangeMap = new Map();
    const pnBases = [...partMap.values()].map(p => p.partNumberBase).filter(Boolean);
    if (pnBases.length > 0) {
      try {
        const yearRanges = await database('Auto')
          .join('AutoItemCompatibility', 'Auto.id', 'AutoItemCompatibility.autoId')
          .join('Item', 'AutoItemCompatibility.itemId', 'Item.id')
          .whereRaw('UPPER("Auto"."make") = UPPER(?)', [make])
          .whereIn('Item.partNumberBase', pnBases)
          .select('Item.partNumberBase')
          .min('Auto.year as minYear')
          .max('Auto.year as maxYear')
          .groupBy('Item.partNumberBase');
        for (const r of yearRanges) {
          yearRangeMap.set(r.partNumberBase, { min: r.minYear, max: r.maxYear });
        }
      } catch (e) {}
    }

    // Step 4: Enrich each part with demand, stock, market, mark status
    // Load all enrichment data in batch
    const allPNs = [...partMap.values()].map(p => p.partNumberBase).filter(Boolean);

    // Batch: market_demand_cache
    let marketMap = new Map();
    if (allPNs.length > 0) {
      try {
        const cached = await database('market_demand_cache')
          .whereIn('part_number_base', allPNs)
          .select('part_number_base', 'ebay_avg_price', 'ebay_sold_90d', 'ebay_median_price', 'market_score');
        for (const c of cached) marketMap.set(c.part_number_base, c);
      } catch (e) {}
    }

    // Batch: the_mark
    let markPNs = new Set();
    try {
      const marks = await database('the_mark').where('active', true).select('partNumber');
      for (const m of marks) { if (m.partNumber) markPNs.add(m.partNumber.toUpperCase()); }
    } catch (e) {}

    // Per-part enrichment
    const enrichedParts = [];
    for (const [key, part] of partMap) {
      // YOUR DEMAND — YourSale
      let yourDemand = { salesCount: 0, avgPrice: 0, lastSoldDate: null, totalRevenue: 0 };
      try {
        const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        let salesQuery;
        if (part.partNumberBase) {
          salesQuery = database('YourSale')
            .where('soldDate', '>=', cutoff)
            .where('title', 'ilike', `%${part.partNumberBase}%`);
        } else {
          salesQuery = database('YourSale')
            .where('soldDate', '>=', cutoff)
            .where('title', 'ilike', `%${make}%`)
            .where('title', 'ilike', `%${part.partType}%`);
        }
        const sales = await salesQuery.select('salePrice', 'soldDate').limit(50);
        if (sales.length > 0) {
          yourDemand.salesCount = sales.length;
          yourDemand.totalRevenue = sales.reduce((s, r) => s + (parseFloat(r.salePrice) || 0), 0);
          yourDemand.avgPrice = Math.round(yourDemand.totalRevenue / sales.length);
          yourDemand.lastSoldDate = sales.sort((a, b) => new Date(b.soldDate) - new Date(a.soldDate))[0].soldDate;
        }
      } catch (e) {}

      // YOUR STOCK — YourListing
      let yourStock = { count: 0, prices: [] };
      try {
        let stockQuery;
        if (part.partNumberBase) {
          stockQuery = database('YourListing')
            .where('listingStatus', 'Active')
            .where(function() {
              this.where('title', 'ilike', `%${part.partNumberBase}%`)
                .orWhere('sku', 'ilike', `%${part.partNumberBase}%`);
            });
        } else {
          stockQuery = database('YourListing')
            .where('listingStatus', 'Active')
            .where('title', 'ilike', `%${make}%`)
            .where('title', 'ilike', `%${part.partType}%`);
        }
        const listings = await stockQuery.select('currentPrice').limit(20);
        yourStock.count = listings.length;
        yourStock.prices = listings.map(l => parseFloat(l.currentPrice)).filter(p => p > 0);
      } catch (e) {}

      // MARKET DATA — market_demand_cache
      let market = { source: 'none', message: 'No market data available' };
      const cached = part.partNumberBase ? marketMap.get(part.partNumberBase) : null;
      if (cached && parseFloat(cached.ebay_avg_price) > 0) {
        market = {
          source: 'cache',
          avgPrice: parseFloat(cached.ebay_avg_price),
          soldCount90d: parseInt(cached.ebay_sold_90d) || 0,
          medianPrice: parseFloat(cached.ebay_median_price) || parseFloat(cached.ebay_avg_price),
          score: parseFloat(cached.market_score) || 0,
        };
      }

      // MARK STATUS
      const isMarked = part.partNumberBase ? markPNs.has(part.partNumberBase.toUpperCase()) : false;

      // SCORING
      const bestPrice = market.source === 'cache' ? market.avgPrice
        : yourDemand.avgPrice > 0 ? yourDemand.avgPrice
        : part.itemPrice;

      let score = 0;
      // Demand (max 35)
      if (yourDemand.salesCount >= 5) score += 35;
      else if (yourDemand.salesCount >= 3) score += 25;
      else if (yourDemand.salesCount >= 1) score += 15;
      else if (market.soldCount90d >= 10) score += 20;
      else if (market.soldCount90d >= 3) score += 10;
      // Price (max 25)
      if (bestPrice >= 300) score += 25;
      else if (bestPrice >= 200) score += 20;
      else if (bestPrice >= 150) score += 15;
      else if (bestPrice >= 100) score += 10;
      // Supply penalty
      if (yourStock.count >= 3) score -= 10;
      // Mark boost
      if (isMarked) score += 15;
      score = Math.max(0, Math.min(100, score));

      // Year range for this part
      const yr = part.partNumberBase ? yearRangeMap.get(part.partNumberBase) : null;

      enrichedParts.push({
        partType: part.partType,
        partNumberBase: part.partNumberBase,
        title: part.title,
        itemId: part.itemId,
        score,
        badge: getBadge(bestPrice),
        isMarked,
        yourDemand,
        yourStock,
        market,
        referencePrice: part.itemPrice > 0 ? part.itemPrice : null,
        yearRange: yr || null,
      });
    }

    // Sort by score desc
    enrichedParts.sort((a, b) => b.score - a.score);

    const result = {
      vehicle: { year, make, model, engine, drivetrain: drivetrain || null },
      totalParts: enrichedParts.length,
      totalEstimatedValue: enrichedParts.reduce((s, p) => {
        const price = p.market.source === 'cache' ? p.market.avgPrice : p.yourDemand.avgPrice || p.referencePrice || 0;
        return s + price;
      }, 0),
      parts: enrichedParts,
      researchedAt: new Date().toISOString(),
      dataSource: 'database',
    };

    // Cache result
    try {
      await database.raw(`
        INSERT INTO instant_research_cache (vehicle_key, vehicle_display, results, last_updated)
        VALUES (?, ?, ?::jsonb, NOW())
        ON CONFLICT (vehicle_key) DO UPDATE SET results = EXCLUDED.results, last_updated = NOW()
      `, [cacheKey, `${year} ${make} ${model}${engine ? ' ' + engine : ''}`, JSON.stringify(result)]);
    } catch (e) { /* cache write optional */ }

    return { ...result, cached: false };
  }
}

module.exports = InstantResearchService;
