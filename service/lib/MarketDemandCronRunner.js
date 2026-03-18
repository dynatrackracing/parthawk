'use strict';

const { log } = require('./logger');
const { database } = require('../database/database');
const { normalizePartNumber } = require('./partNumberUtils');
const axios = require('axios');
const xml2js = require('xml2js');

const CACHE_TTL_HOURS = 24;

/**
 * MarketDemandCronRunner - Nightly job to update market_demand_cache
 * for all normalized part numbers in the Item table.
 *
 * Runs at 3am after LKQ scrape at 2am.
 * Uses eBay Finding API findCompletedItems for sold data.
 */
class MarketDemandCronRunner {
  constructor() {
    this.log = log.child({ class: 'MarketDemandCronRunner' }, true);
  }

  async work() {
    this.log.info('Starting market demand cache update');

    let partNumbers;
    try {
      // Get distinct normalized part numbers from Item table
      const rows = await database('Item')
        .whereNotNull('partNumberBase')
        .where('partNumberBase', '!=', '')
        .distinct('partNumberBase')
        .select('partNumberBase');
      partNumbers = rows.map(r => r.partNumberBase);
    } catch (err) {
      this.log.error({ err: err.message }, 'Could not query Item table for part numbers');
      return;
    }

    this.log.info({ count: partNumbers.length }, 'Part numbers to check');

    let updated = 0;
    let skipped = 0;

    for (const pn of partNumbers) {
      // Check if cache is still fresh (< 24h old)
      try {
        const existing = await database('market_demand_cache')
          .where('part_number_base', pn).first();
        if (existing) {
          const age = Date.now() - new Date(existing.last_updated).getTime();
          if (age < CACHE_TTL_HOURS * 60 * 60 * 1000) {
            skipped++;
            continue;
          }
        }
      } catch (e) {
        // Table may not exist yet
      }

      // Query eBay for sold listings
      try {
        const result = await this.queryEbaySold(pn);
        await this.upsertCache(pn, result);
        updated++;
      } catch (err) {
        this.log.warn({ err: err.message, pn }, 'eBay query failed for part number');
      }

      // Rate limit: 100ms between calls to avoid eBay throttling
      await new Promise(r => setTimeout(r, 100));
    }

    this.log.info({ updated, skipped, total: partNumbers.length }, 'Market demand cache update complete');
  }

  /**
   * Query eBay Finding API for completed/sold items matching a part number.
   * Returns { soldCount, avgPrice, activeListings }
   */
  async queryEbaySold(partNumber) {
    const appName = process.env.FINDINGS_APP_NAME;
    if (!appName) {
      // No eBay credentials — return zero data
      return { soldCount: 0, avgPrice: 0, activeListings: 0 };
    }

    const url = 'https://svcs.ebay.com/services/search/FindingService/v1';

    // Query completed items (sold in last 90 days)
    const soldXml = `<?xml version='1.0' encoding='utf-8'?>
      <findCompletedItemsRequest xmlns="http://www.ebay.com/marketplace/search/v1/services">
        <keywords>${escapeXml(partNumber)}</keywords>
        <itemFilter><name>SoldItemsOnly</name><value>true</value></itemFilter>
        <paginationInput><entriesPerPage>50</entriesPerPage><pageNumber>1</pageNumber></paginationInput>
      </findCompletedItemsRequest>`;

    let soldCount = 0;
    let totalPrice = 0;

    try {
      const response = await axios({
        method: 'POST', url, timeout: 15000,
        headers: {
          'X-EBAY-SOA-SERVICE-NAME': 'FindingService',
          'X-EBAY-SOA-OPERATION-NAME': 'findCompletedItems',
          'X-EBAY-SOA-SECURITY-APPNAME': appName,
          'X-EBAY-SOA-GLOBAL-ID': 'EBAY-US',
          'X-EBAY-SOA-REQUEST-DATA-FORMAT': 'XML',
          'X-EBAY-SOA-RESPONSE-DATA-FORMAT': 'XML',
          'Content-Type': 'text/xml',
        },
        data: soldXml,
      });

      const parsed = await xml2js.parseStringPromise(response.data);
      const searchResult = parsed?.findCompletedItemsResponse?.searchResult?.[0];
      const items = searchResult?.item || [];
      soldCount = parseInt(searchResult?.$?.count || items.length);

      for (const item of items) {
        const price = parseFloat(item?.sellingStatus?.[0]?.currentPrice?.[0]?._ || 0);
        totalPrice += price;
      }
    } catch (err) {
      this.log.warn({ err: err.message }, 'findCompletedItems failed');
    }

    const avgPrice = soldCount > 0 ? totalPrice / soldCount : 0;

    // Query active listings count
    let activeListings = 0;
    try {
      const activeXml = `<?xml version='1.0' encoding='utf-8'?>
        <findItemsByKeywordsRequest xmlns="http://www.ebay.com/marketplace/search/v1/services">
          <keywords>${escapeXml(partNumber)}</keywords>
          <paginationInput><entriesPerPage>1</entriesPerPage><pageNumber>1</pageNumber></paginationInput>
        </findItemsByKeywordsRequest>`;

      const response = await axios({
        method: 'POST', url, timeout: 15000,
        headers: {
          'X-EBAY-SOA-SERVICE-NAME': 'FindingService',
          'X-EBAY-SOA-OPERATION-NAME': 'findItemsByKeywords',
          'X-EBAY-SOA-SECURITY-APPNAME': appName,
          'X-EBAY-SOA-GLOBAL-ID': 'EBAY-US',
          'X-EBAY-SOA-REQUEST-DATA-FORMAT': 'XML',
          'X-EBAY-SOA-RESPONSE-DATA-FORMAT': 'XML',
          'Content-Type': 'text/xml',
        },
        data: activeXml,
      });

      const parsed = await xml2js.parseStringPromise(response.data);
      activeListings = parseInt(
        parsed?.findItemsByKeywordsResponse?.paginationOutput?.[0]?.totalEntries?.[0] || 0
      );
    } catch (err) {
      this.log.warn({ err: err.message }, 'findItemsByKeywords failed');
    }

    return { soldCount, avgPrice, activeListings };
  }

  async upsertCache(partNumberBase, { soldCount, avgPrice, activeListings }) {
    const marketScore = activeListings > 0 ? Math.round((soldCount / activeListings) * 100) / 100 : 0;

    try {
      const existing = await database('market_demand_cache')
        .where('part_number_base', partNumberBase).first();

      if (existing) {
        await database('market_demand_cache')
          .where('id', existing.id)
          .update({
            ebay_sold_90d: soldCount,
            ebay_avg_price: Math.round(avgPrice * 100) / 100,
            ebay_active_listings: activeListings,
            market_score: marketScore,
            last_updated: new Date(),
          });
      } else {
        await database('market_demand_cache').insert({
          part_number_base: partNumberBase,
          ebay_sold_90d: soldCount,
          ebay_avg_price: Math.round(avgPrice * 100) / 100,
          ebay_active_listings: activeListings,
          market_score: marketScore,
          last_updated: new Date(),
          createdAt: new Date(),
        });
      }
    } catch (err) {
      this.log.warn({ err: err.message, partNumberBase }, 'market_demand_cache upsert failed');
    }
  }
}

function escapeXml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = MarketDemandCronRunner;
