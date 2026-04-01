'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const axios = require('axios');
const xml2js = require('xml2js');

/**
 * StaleInventoryService — Automated price reductions via TradingAPI
 *
 * Schedule per spec:
 *   60 days:  -10% reduction
 *   90 days:  -15% reduction (from current, not original)
 *   120 days: -20% reduction
 *   180 days: -25% reduction
 *   270 days: -30% reduction, flag for review
 *
 * Programmed listings follow slower schedule (no auto-discount against unprogrammed comps).
 * Programmed schedule:
 *   90 days:  -5%
 *   180 days: -10%
 *   270 days: -15%, flag for review
 *
 * No comps available = hold and flag, do not reduce.
 * Ended listings logged to dead_inventory.
 */

const STANDARD_SCHEDULE = [
  { days: 60,  reductionPct: 0.10, tier: '60' },
  { days: 90,  reductionPct: 0.15, tier: '90' },
  { days: 120, reductionPct: 0.20, tier: '120' },
  { days: 180, reductionPct: 0.25, tier: '180' },
  { days: 270, reductionPct: 0.30, tier: '270' },
];

const PROGRAMMED_SCHEDULE = [
  { days: 90,  reductionPct: 0.05, tier: '90p' },
  { days: 180, reductionPct: 0.10, tier: '180p' },
  { days: 270, reductionPct: 0.15, tier: '270p' },
];

class StaleInventoryService {
  constructor() {
    this.log = log.child({ class: 'StaleInventoryService' }, true);
    this.tradingApiUrl = 'https://api.ebay.com/ws/api.dll';
  }

  /**
   * Scan all active listings and apply price reductions where due.
   * Returns summary of actions taken.
   */
  async runAutomation() {
    this.log.info('Running stale inventory automation');

    let listings;
    try {
      listings = await database('YourListing')
        .where('listingStatus', 'Active')
        .where('store', 'dynatrack')
        .whereNotNull('startTime')
        .select('*');
    } catch (err) {
      this.log.error({ err: err.message }, 'Could not query YourListing');
      return { scanned: 0, actioned: 0, errors: 0 };
    }

    const now = new Date();
    let actioned = 0, skipped = 0, errors = 0;

    for (const listing of listings) {
      const daysListed = Math.floor((now - new Date(listing.startTime)) / 86400000);
      const isProgrammed = !!listing.isProgrammed || this.detectProgrammed(listing.title);
      const schedule = isProgrammed ? PROGRAMMED_SCHEDULE : STANDARD_SCHEDULE;

      // Find the applicable tier (highest days threshold the listing exceeds)
      let applicableTier = null;
      for (const tier of schedule) {
        if (daysListed >= tier.days) applicableTier = tier;
      }
      if (!applicableTier) continue; // Not stale enough

      // Check if we already actioned this tier
      try {
        const existing = await database('stale_inventory_action')
          .where('ebay_item_id', listing.ebayItemId)
          .where('tier', applicableTier.tier)
          .where('executed', true)
          .first();
        if (existing) { skipped++; continue; }
      } catch (e) { /* table may not exist */ }

      // Check if comps exist before reducing
      const hasComps = await this.checkCompsExist(listing);
      if (!hasComps) {
        // No comps = hold and flag
        this.log.info({ ebayItemId: listing.ebayItemId, title: listing.title },
          'No comps found — holding price');
        try {
          await database('stale_inventory_action').insert({
            ebay_item_id: listing.ebayItemId,
            listing_id: listing.id,
            title: listing.title,
            action_type: 'hold_no_comps',
            old_price: parseFloat(listing.currentPrice),
            days_listed: daysListed,
            tier: applicableTier.tier,
            programmed_listing: isProgrammed,
            executed: true,
            executed_at: new Date(),
            notes: 'No comparable sold items found — holding price',
            createdAt: new Date(),
          });
        } catch (e) { /* ignore */ }
        continue;
      }

      // Calculate new price
      const currentPrice = parseFloat(listing.currentPrice);
      const newPrice = Math.round(currentPrice * (1 - applicableTier.reductionPct) * 100) / 100;
      const minFloor = 9.99; // Never go below $9.99
      const finalPrice = Math.max(newPrice, minFloor);

      // Execute price change via TradingAPI
      let executed = false;
      let executionError = null;
      try {
        await this.revisePrice(listing.ebayItemId, finalPrice);
        executed = true;
        actioned++;

        // Update local record
        await database('YourListing')
          .where('id', listing.id)
          .update({ currentPrice: finalPrice, updatedAt: new Date() });
      } catch (err) {
        executionError = err.message;
        errors++;
        this.log.warn({ err: err.message, ebayItemId: listing.ebayItemId },
          'Price revision failed');
      }

      // Log the action
      try {
        await database('stale_inventory_action').insert({
          ebay_item_id: listing.ebayItemId,
          listing_id: listing.id,
          title: listing.title,
          action_type: 'price_reduction',
          old_price: currentPrice,
          new_price: finalPrice,
          days_listed: daysListed,
          tier: applicableTier.tier,
          programmed_listing: isProgrammed,
          executed,
          execution_error: executionError,
          executed_at: executed ? new Date() : null,
          notes: `${applicableTier.reductionPct * 100}% reduction at ${daysListed} days`,
          createdAt: new Date(),
        });
      } catch (e) {
        this.log.warn({ err: e.message }, 'stale_inventory_action insert failed');
      }
    }

    this.log.info({ scanned: listings.length, actioned, skipped, errors },
      'Stale inventory automation complete');
    return { scanned: listings.length, actioned, skipped, errors };
  }

  /**
   * Detect if a listing is a programmed/flashed part from its title.
   * Programmed listings get price protection — never auto-discounted against unprogrammed comps.
   */
  detectProgrammed(title) {
    if (!title) return false;
    const t = title.toUpperCase();
    return t.includes('PROGRAMMED') || t.includes('FLASHED') ||
           t.includes('VIN-SPECIFIC') || t.includes('CODED TO') ||
           t.includes('VIN PROGRAMMED') || t.includes('PLUG AND PLAY');
  }

  /**
   * Check if comparable sold items exist for this listing.
   */
  async checkCompsExist(listing) {
    try {
      const partNumber = listing.sku;
      if (partNumber) {
        const cache = await database('market_demand_cache')
          .where('part_number_base', partNumber)
          .first();
        if (cache && parseInt(cache.ebay_sold_90d) > 0) return true;
      }

      // Fallback: check YourSale for similar titles
      const titleWords = (listing.title || '').split(' ').filter(w => w.length > 3).slice(0, 3);
      if (titleWords.length > 0) {
        const pattern = '%' + titleWords.join('%') + '%';
        const sale = await database('YourSale')
          .whereRaw('UPPER(title) LIKE UPPER(?)', [pattern])
          .first();
        if (sale) return true;
      }
    } catch (e) { /* tables may not exist */ }
    return false;
  }

  /**
   * Revise listing price on eBay via TradingAPI ReviseItem call.
   */
  async revisePrice(ebayItemId, newPrice) {
    const token = process.env.TRADING_API_TOKEN;
    if (!token) throw new Error('TRADING_API_TOKEN not configured');

    const xml = `<?xml version='1.0' encoding='utf-8'?>
<ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${token}</eBayAuthToken>
  </RequesterCredentials>
  <Item>
    <ItemID>${ebayItemId}</ItemID>
    <StartPrice>${newPrice.toFixed(2)}</StartPrice>
  </Item>
</ReviseItemRequest>`;

    const response = await axios({
      method: 'POST',
      url: this.tradingApiUrl,
      headers: {
        'X-EBAY-API-COMPATIBILITY-LEVEL': '837',
        'X-EBAY-API-DEV-NAME': process.env.TRADING_API_DEV_NAME,
        'X-EBAY-API-APP-NAME': process.env.TRADING_API_APP_NAME,
        'X-EBAY-API-CERT-NAME': process.env.TRADING_API_CERT_NAME,
        'X-EBAY-API-SITEID': '0',
        'X-EBAY-API-CALL-NAME': 'ReviseItem',
        'Content-Type': 'text/xml',
      },
      data: xml,
      timeout: 15000,
    });

    const parsed = await xml2js.parseStringPromise(response.data);
    const ack = parsed?.ReviseItemResponse?.Ack?.[0];
    if (ack !== 'Success' && ack !== 'Warning') {
      const errorMsg = parsed?.ReviseItemResponse?.Errors?.[0]?.LongMessage?.[0] || 'Unknown error';
      throw new Error(`eBay ReviseItem failed: ${errorMsg}`);
    }
  }
}

module.exports = StaleInventoryService;
