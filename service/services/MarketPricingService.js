'use strict';

/**
 * MarketPricingService — Batch market pricing for DAILY FEED parts.
 *
 * Takes matched parts, deduplicates by PN, checks cache, scrapes
 * eBay sold comps for uncached parts, stores in market_demand_cache.
 *
 * Primary scraper: PriceCheckServiceV2 (axios+cheerio, no Chromium).
 * Fallback: PriceCheckService V1 (Playwright) if V2 returns 0 results.
 */

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const { extractPartNumbers } = require('../utils/partIntelligence');
const priceCheckV2 = require('./PriceCheckServiceV2');

// V1 Playwright fallback — may not be available on all environments
let priceCheckV1 = null;
try {
  priceCheckV1 = require('./PriceCheckService');
} catch (e) {
  log.info('[MarketPricing] PriceCheckService V1 (Playwright) not available, V2-only mode');
}

const CACHE_TTL_HOURS = 72; // 3 days — market data doesn't change that fast

/**
 * Build optimal search query for a part.
 * TIER 1: Part number (most specific). TIER 2: Year+make+model+partType.
 */
function buildSearchQuery(part) {
  const pns = extractPartNumbers(part.title || '');

  // TIER 1: Part number search
  if (pns.length > 0) {
    const pn = pns[0];
    return {
      query: pn.raw, // raw format with dashes: "9L34-2C405-A"
      method: 'PART_NUMBER',
      cacheKey: pn.base, // normalized base for cache dedup
    };
  }

  // TIER 2: Specific keywords
  const parts = [];
  if (part.year) parts.push(String(part.year));
  if (part.make) parts.push(part.make);
  if (part.model) parts.push(part.model);
  if (part.partType) parts.push(part.partType);

  const query = parts.join(' ');
  const cacheKey = parts.map(p => (p || '').toUpperCase()).join('|');

  return { query, method: 'KEYWORD', cacheKey };
}

/**
 * Check market_demand_cache for recent data.
 */
async function getCachedPrice(cacheKey) {
  try {
    const row = await database('market_demand_cache')
      .where('part_number_base', cacheKey)
      .whereRaw(`last_updated > NOW() - INTERVAL '${CACHE_TTL_HOURS} hours'`)
      .first();

    if (row) {
      const price = parseFloat(row.ebay_avg_price) || 0;
      const count = parseInt(row.ebay_sold_90d) || 0;
      if (price === 0 && count === 0) return null; // Empty cache entry
      return {
        median: price,
        avg: price,
        count: count,
        velocity: count / 13,
        cached: true,
        checkedAt: row.last_updated,
      };
    }
  } catch (err) {
    log.warn({ err: err.message }, '[MarketPricing] Cache read error');
  }
  return null;
}

/**
 * Store result in market_demand_cache.
 */
async function cachePrice(cacheKey, part, result) {
  try {
    // Table columns: id, part_number_base, ebay_sold_90d, ebay_avg_price,
    // ebay_active_listings, market_score, last_updated, createdAt
    await database.raw(`
      INSERT INTO market_demand_cache
        (id, part_number_base, ebay_avg_price, ebay_sold_90d,
         last_updated, "createdAt")
      VALUES (
        gen_random_uuid(), ?, ?, ?,
        NOW(), NOW()
      )
      ON CONFLICT (part_number_base)
      DO UPDATE SET
        ebay_avg_price = EXCLUDED.ebay_avg_price,
        ebay_sold_90d = EXCLUDED.ebay_sold_90d,
        last_updated = NOW()
    `, [
      cacheKey,
      result.median || result.avg || 0,
      result.count || 0,
    ]);
  } catch (err) {
    log.warn({ err: err.message, cacheKey }, '[MarketPricing] Cache write error');
  }
}

/**
 * Scrape sold comps for a single search query.
 * Primary: V2 (axios+cheerio). Fallback: V1 (Playwright) if V2 gets 0 results.
 * Returns { count, avg, median, min, max, salesPerWeek }.
 */
async function scrapeComps(searchQuery) {
  // Try V2 first (lightweight, no Chromium)
  try {
    const v2Result = await priceCheckV2.check(searchQuery, 0);
    if (v2Result && v2Result.metrics && v2Result.metrics.count > 0) {
      return {
        count: v2Result.metrics.count,
        avg: v2Result.metrics.avg,
        median: v2Result.metrics.median,
        min: v2Result.metrics.min,
        max: v2Result.metrics.max,
        salesPerWeek: v2Result.metrics.salesPerWeek,
      };
    }
  } catch (err) {
    log.debug({ err: err.message, query: searchQuery }, '[MarketPricing] V2 scrape failed');
  }

  // Fallback to V1 (Playwright) if available and V2 returned nothing
  if (priceCheckV1) {
    try {
      const items = await priceCheckV1.scrapeSoldItems(searchQuery);
      if (items && items.length > 0) {
        const metrics = priceCheckV1.calculateMetrics(items, 0);
        return metrics;
      }
    } catch (err) {
      log.debug({ err: err.message, query: searchQuery }, '[MarketPricing] V1 fallback failed');
    }
  }

  return null;
}

/**
 * Run market pricing for a single query (for the test route).
 */
async function singlePriceCheck(query) {
  // Check cache first
  const cached = await getCachedPrice(query.toUpperCase().replace(/[\s\-\.]/g, ''));
  if (cached) return { ...cached, query, source: 'cache' };

  // Scrape
  const comps = await scrapeComps(query);
  if (!comps || comps.count === 0) {
    return { count: 0, query, source: 'scrape', message: 'No sold comps found' };
  }

  // Cache it
  const pns = extractPartNumbers(query);
  const cacheKey = pns.length > 0 ? pns[0].base : query.toUpperCase().replace(/[\s\-\.]/g, '');
  await cachePrice(cacheKey, { make: null, model: null, partType: null }, comps);

  return {
    median: comps.median,
    avg: comps.avg,
    min: comps.min,
    max: comps.max,
    count: comps.count,
    salesPerWeek: comps.salesPerWeek,
    query,
    source: 'scrape',
  };
}

/**
 * Run market pricing for a batch of parts.
 * Deduplicates, checks cache, scrapes uncached, stores results.
 */
async function batchPriceCheck(parts) {
  const results = new Map();

  // Step 1: Build queries and dedup
  const queries = new Map(); // cacheKey → { query, method, part }
  for (const part of parts) {
    const sq = buildSearchQuery(part);
    if (!queries.has(sq.cacheKey)) {
      queries.set(sq.cacheKey, { ...sq, part });
    }
  }

  log.info({ total: parts.length, unique: queries.size }, '[MarketPricing] Batch start');

  // Step 2: Check cache
  const uncached = [];
  for (const [cacheKey, queryInfo] of queries) {
    const cached = await getCachedPrice(cacheKey);
    if (cached) {
      results.set(cacheKey, cached);
    } else {
      uncached.push({ cacheKey, ...queryInfo });
    }
  }

  log.info({ cached: results.size, toScrape: uncached.length }, '[MarketPricing] Cache check done');

  // Step 3: Scrape uncached (with rate limiting)
  let scraped = 0, failed = 0;
  for (const item of uncached) {
    try {
      const comps = await scrapeComps(item.query);
      if (comps && comps.count > 0) {
        const result = {
          median: comps.median,
          avg: comps.avg,
          min: comps.min,
          max: comps.max,
          count: comps.count,
          velocity: comps.salesPerWeek || (comps.count / 13),
          method: item.method,
          query: item.query,
          checkedAt: new Date(),
        };
        results.set(item.cacheKey, result);
        await cachePrice(item.cacheKey, item.part, result);
        scraped++;
      }

      // Rate limit: 2-3 second delay
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
    } catch (err) {
      log.warn({ err: err.message, query: item.query }, '[MarketPricing] Scrape failed');
      failed++;
    }
  }

  log.info({ scraped, failed, totalResults: results.size }, '[MarketPricing] Batch complete');
  return results;
}

/**
 * Full pricing pass: score all yard vehicles, collect matched parts, batch price them.
 */
async function runPricingPass() {
  log.info('[MarketPricing] Starting full pricing pass');
  const AttackListService = require('./AttackListService');
  const service = new AttackListService();

  try {
    const allResults = await service.getAllYardsAttackList({ daysBack: 90 });
    const parts = [];
    for (const yard of allResults) {
      for (const v of (yard.vehicles || [])) {
        for (const p of (v.parts || [])) {
          if (p.partType && p.price > 50) {
            parts.push({
              title: p.title,
              make: v.make,
              model: v.model,
              year: parseInt(v.year),
              partType: p.partType,
            });
          }
        }
      }
    }

    if (parts.length === 0) {
      log.info('[MarketPricing] No parts to price');
      return { parts: 0, results: 0 };
    }

    log.info({ partCount: parts.length }, '[MarketPricing] Collected parts, starting batch');
    const results = await batchPriceCheck(parts);
    log.info({ partCount: parts.length, results: results.size }, '[MarketPricing] Pricing pass complete');
    return { parts: parts.length, results: results.size };
  } catch (err) {
    log.error({ err: err.message }, '[MarketPricing] Pricing pass failed');
    throw err;
  }
}

module.exports = { buildSearchQuery, batchPriceCheck, getCachedPrice, singlePriceCheck, runPricingPass };
