'use strict';

const { database } = require('../database/database');

/**
 * Resolve the best available price for a part number.
 * Priority: market_demand_cache (fresh) > PriceCheck > Item.price (frozen reference)
 *
 * Freshness: fresh = <30d, aging = 30-60d, stale = 60-90d, expired = >90d (treated as missing)
 */

function getFreshness(updatedAt) {
  if (!updatedAt) return 'frozen';
  const daysAgo = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000);
  if (daysAgo <= 30) return 'fresh';
  if (daysAgo <= 60) return 'aging';
  if (daysAgo <= 90) return 'stale';
  return 'expired';
}

/**
 * Batch resolve prices for multiple part numbers in minimal queries.
 * @param {string[]} partNumbers - array of partNumberBase values
 * @param {Object} options
 * @param {Map} options.cacheIndex - pre-loaded cache data (optional)
 * @param {Map} options.itemPrices - Map of partNumberBase -> Item.price (optional)
 * @returns {Map<string, {price, source, freshness, details}>}
 */
async function resolvePricesBatch(partNumbers, options = {}) {
  const results = new Map();
  if (!partNumbers || partNumbers.length === 0) return results;

  const unique = [...new Set(partNumbers.filter(Boolean).map(pn => pn.replace(/[\s\-\.]/g, '').toUpperCase()))];

  // Step 1: market_demand_cache (best source)
  let cacheMap = options.cacheIndex || new Map();
  if (!options.cacheIndex && unique.length > 0) {
    try {
      const rows = await database('market_demand_cache')
        .whereIn('part_number_base', unique)
        .select('part_number_base', 'ebay_avg_price', 'ebay_median_price', 'ebay_sold_90d',
                'ebay_min_price', 'ebay_max_price', 'market_score', 'last_updated');
      for (const r of rows) cacheMap.set(r.part_number_base, r);
    } catch (e) { /* table may not exist */ }
  }

  const remaining = [];
  for (const pn of unique) {
    const cached = cacheMap.get(pn);
    if (cached) {
      const price = parseFloat(cached.ebay_avg_price) || 0;
      const freshness = getFreshness(cached.last_updated);
      if (price > 0 && freshness !== 'expired') {
        results.set(pn, {
          price,
          source: 'market_cache',
          freshness,
          details: {
            median: parseFloat(cached.ebay_median_price) || price,
            min: parseFloat(cached.ebay_min_price) || null,
            max: parseFloat(cached.ebay_max_price) || null,
            soldCount: parseInt(cached.ebay_sold_90d) || 0,
            updatedAt: cached.last_updated,
          },
        });
        continue;
      }
    }
    remaining.push(pn);
  }

  // Step 2: PriceCheck (per-listing checks, match by partNumberBase in title/searchQuery)
  // This is expensive per-PN, so skip in batch mode — the cache is the primary source
  // PriceCheck data feeds INTO market_demand_cache via Phase 1c, so cache covers this

  // Step 3: Item.price (frozen reference)
  for (const pn of remaining) {
    const itemPrice = options.itemPrices ? options.itemPrices.get(pn) : null;
    if (itemPrice && itemPrice > 0) {
      results.set(pn, {
        price: itemPrice,
        source: 'item_reference',
        freshness: 'frozen',
        details: { warning: 'Price from frozen Item table — may be outdated' },
      });
    } else {
      results.set(pn, {
        price: null,
        source: 'none',
        freshness: null,
        details: { warning: 'No pricing data available' },
      });
    }
  }

  return results;
}

/**
 * Resolve price for a single part number.
 */
async function resolvePrice(partNumberBase, options = {}) {
  if (!partNumberBase) {
    return { price: options.itemPrice || null, source: options.itemPrice ? 'item_reference' : 'none', freshness: options.itemPrice ? 'frozen' : null, details: {} };
  }
  const batch = await resolvePricesBatch([partNumberBase], options);
  return batch.get(partNumberBase) || { price: null, source: 'none', freshness: null, details: {} };
}

module.exports = { resolvePrice, resolvePricesBatch, getFreshness };
