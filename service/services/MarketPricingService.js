'use strict';

/**
 * MarketPricingService — Batch market pricing for DAILY FEED parts.
 *
 * Takes matched parts, deduplicates by PN, checks cache, scrapes
 * eBay sold comps for uncached parts, stores in market_demand_cache.
 *
 * Uses PriceCheckService's scraper (persistent Playwright page) and
 * metrics calculator — no new scraping infrastructure.
 */

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const { extractPartNumbers } = require('../utils/partIntelligence');
const priceCheckService = require('./PriceCheckService');

const CACHE_TTL_HOURS = 24;

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
      return {
        median: parseFloat(row.market_avg_price) || 0,
        avg: parseFloat(row.market_avg_price) || 0,
        count: parseInt(row.market_sold_count) || parseInt(row.ebay_sold_90d) || 0,
        velocity: (parseInt(row.ebay_sold_90d) || 0) / 13,
        min: null,
        max: null,
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
    await database.raw(`
      INSERT INTO market_demand_cache
        (id, part_number_base, make, model, part_type,
         market_avg_price, market_sold_count, ebay_sold_90d,
         last_updated, "createdAt", "updatedAt")
      VALUES (
        gen_random_uuid(), ?, ?, ?, ?,
        ?, ?, ?,
        NOW(), NOW(), NOW()
      )
      ON CONFLICT (part_number_base)
      DO UPDATE SET
        market_avg_price = EXCLUDED.market_avg_price,
        market_sold_count = EXCLUDED.market_sold_count,
        ebay_sold_90d = EXCLUDED.ebay_sold_90d,
        last_updated = NOW(),
        "updatedAt" = NOW()
    `, [
      cacheKey,
      part.make || null,
      part.model || null,
      part.partType || null,
      result.median || result.avg,
      result.count,
      result.count,
    ]);
  } catch (err) {
    log.warn({ err: err.message, cacheKey }, '[MarketPricing] Cache write error');
  }
}

/**
 * Scrape sold comps for a single search query.
 * Uses PriceCheckService's persistent Playwright page.
 * Returns { count, avg, median, min, max, salesPerWeek }.
 */
async function scrapeComps(searchQuery) {
  // PriceCheckService.scrapeSoldItems returns [{ title, price, soldDate }]
  const items = await priceCheckService.scrapeSoldItems(searchQuery);
  if (!items || items.length === 0) return null;

  // Use PriceCheckService's metrics calculator
  // Pass 0 as yourPrice since we don't need the verdict here
  const metrics = priceCheckService.calculateMetrics(items, 0);
  return metrics;
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
