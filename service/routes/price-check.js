'use strict';

const express = require('express');
const router = express.Router();
const { log } = require('../lib/logger');
const PriceCheckService = require('../services/PriceCheckService');
const PriceCheckCronRunner = require('../lib/PriceCheckCronRunner');
const YourListing = require('../models/YourListing');
const PriceCheck = require('../models/PriceCheck');

/**
 * POST /price-check/omit
 * Omit or un-omit one or more listings from automated price checks.
 * Works as both a single and bulk API — pass one or many listingIds.
 * Body: { listingIds: string[], omit: boolean }
 */
router.post('/omit', async (req, res) => {
  try {
    const { listingIds, omit } = req.body;

    if (!listingIds || !Array.isArray(listingIds) || listingIds.length === 0) {
      return res.status(400).json({ success: false, error: 'listingIds array is required' });
    }
    if (typeof omit !== 'boolean') {
      return res.status(400).json({ success: false, error: 'omit (boolean) is required' });
    }

    await YourListing.query()
      .patch({ priceCheckOmitted: omit })
      .whereIn('id', listingIds);

    return res.json({
      success: true,
      updated: listingIds.length,
      omit,
    });
  } catch (error) {
    console.error('Price check omit error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /price-check/all
 * Get listings with their most recent price check data (paginated)
 * Query params: page (default: 1), limit (default: 50), verdict (optional filter), omitted (optional: 'true'/'false')
 */
router.get('/all', async (req, res) => {
  try {
    const { page = 1, limit = 50, verdict, search, omitted } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Get recent price checks for filtering
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Build listing query - filter by verdict if provided
    let listingQuery = YourListing.query();
    let countQuery = YourListing.query();

    // Omitted filter — default shows non-omitted listings only
    if (omitted === 'true') {
      listingQuery = listingQuery.where('priceCheckOmitted', true);
      countQuery = countQuery.where('priceCheckOmitted', true);
    } else if (omitted === 'false' || omitted === undefined) {
      listingQuery = listingQuery.where('priceCheckOmitted', false);
      countQuery = countQuery.where('priceCheckOmitted', false);
    }
    // omitted=all → no filter applied

    // Title search filter
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      listingQuery = listingQuery.whereRaw('LOWER(title) LIKE LOWER(?)', [term]);
      countQuery = countQuery.whereRaw('LOWER(title) LIKE LOWER(?)', [term]);
    }

    if (verdict && verdict !== 'all') {
      // Get listing IDs that match the verdict filter
      let verdictFilter;
      if (verdict === 'unchecked') {
        // Get listings that DON'T have a recent price check
        const checkedListingIds = await PriceCheck.query()
          .where('checkedAt', '>', cutoff)
          .distinct('listingId')
          .pluck('listingId');

        listingQuery = listingQuery.whereNotIn('id', checkedListingIds);
        countQuery = countQuery.whereNotIn('id', checkedListingIds);
      } else {
        // Get listings that have a price check with the specified verdict
        const matchingVerdicts = verdict === 'atMarket'
          ? ['MARKET PRICE', 'GOOD VALUE']
          : verdict === 'high'
            ? ['OVERPRICED', 'SLIGHTLY HIGH']
            : [verdict.toUpperCase()];

        // Get latest price check per listing with matching verdict
        const matchingListingIds = await PriceCheck.query()
          .where('checkedAt', '>', cutoff)
          .whereIn('verdict', matchingVerdicts)
          .distinct('listingId')
          .pluck('listingId');

        listingQuery = listingQuery.whereIn('id', matchingListingIds);
        countQuery = countQuery.whereIn('id', matchingListingIds);
      }
    }

    // Only show listings confirmed active by a recent sync.
    // The eBay sync runs every 6h and only returns active listings — anything
    // not re-synced within 14 days is ended/removed on eBay.
    // This also naturally deduplicates relisted items (old records go stale).
    const staleCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    listingQuery = listingQuery.where('syncedAt', '>', staleCutoff)
      .where('listingStatus', 'Active')
      .where('quantityAvailable', '>', 0);
    countQuery = countQuery.where('syncedAt', '>', staleCutoff)
      .where('listingStatus', 'Active')
      .where('quantityAvailable', '>', 0);

    // Get paginated listings
    const [listings, countResult] = await Promise.all([
      listingQuery.clone().orderBy('createdAt', 'desc').limit(parseInt(limit)).offset(offset),
      countQuery.clone().count('* as total').first(),
    ]);

    const total = parseInt(countResult?.total || 0);
    const totalPages = Math.ceil(total / parseInt(limit));

    // Calculate daysListed for each
    const now = new Date();
    const listingsWithDays = listings.map(listing => {
      const startTime = listing.startTime ? new Date(listing.startTime) : now;
      const daysListed = Math.floor((now - startTime) / (1000 * 60 * 60 * 24));
      return { ...listing, daysListed: Math.max(0, daysListed) };
    });

    // Get all recent price checks (within 7 days for bulk view)
    const priceChecks = await PriceCheck.query()
      .where('checkedAt', '>', cutoff)
      .orderBy('checkedAt', 'desc');

    // Create a map of listing ID to most recent price check
    const priceCheckMap = {};
    priceChecks.forEach(pc => {
      if (!priceCheckMap[pc.listingId]) {
        priceCheckMap[pc.listingId] = pc;
      }
    });

    // Merge listings with price checks and calculate suggested price
    const results = listingsWithDays.map(listing => {
      const priceCheck = priceCheckMap[listing.id];
      let suggestedPrice = null;
      let priceDiff = null;

      if (priceCheck && priceCheck.marketMedian) {
        // Suggest slightly below median for faster sales
        suggestedPrice = Math.round(parseFloat(priceCheck.marketMedian) * 0.95 * 100) / 100;
        priceDiff = parseFloat(listing.currentPrice) - suggestedPrice;
      }

      // Parse topComps if stored as string
      let topComps = [];
      if (priceCheck?.topComps) {
        try {
          topComps = typeof priceCheck.topComps === 'string'
            ? JSON.parse(priceCheck.topComps)
            : priceCheck.topComps;
        } catch (e) {
          topComps = [];
        }
      }

      return {
        id: listing.id,
        ebayItemId: listing.ebayItemId,
        title: listing.title,
        sku: listing.sku,
        currentPrice: parseFloat(listing.currentPrice),
        daysListed: listing.daysListed,
        viewItemUrl: listing.viewItemUrl,
        priceCheckOmitted: !!listing.priceCheckOmitted,
        priceCheck: priceCheck ? {
          checkedAt: priceCheck.checkedAt,
          verdict: priceCheck.verdict,
          marketMedian: parseFloat(priceCheck.marketMedian),
          marketMin: parseFloat(priceCheck.marketMin),
          marketMax: parseFloat(priceCheck.marketMax),
          compCount: priceCheck.compCount,
          priceDiffPercent: parseFloat(priceCheck.priceDiffPercent),
          suggestedPrice,
          priceDiff,
          // Additional details for expandable view
          searchQuery: priceCheck.searchQuery,
          topComps,
          salesPerWeek: priceCheck.salesPerWeek ? parseFloat(priceCheck.salesPerWeek) : null,
          partType: priceCheck.partType,
          make: priceCheck.make,
          model: priceCheck.model,
          years: priceCheck.years,
        } : null,
      };
    });

    // Summary stats - calculate across ALL listings, not just current page
    // This runs separate queries to get accurate totals
    const [allPriceChecks, totalListingsCount, omittedCount] = await Promise.all([
      PriceCheck.query()
        .where('checkedAt', '>', cutoff)
        .select('listingId', 'verdict')
        .orderBy('checkedAt', 'desc'),
      YourListing.query().count('* as count').first(),
      YourListing.query().where('priceCheckOmitted', true).count('* as count').first(),
    ]);

    // Create map of latest verdict per listing
    const verdictMap = {};
    allPriceChecks.forEach(pc => {
      if (!verdictMap[pc.listingId]) {
        verdictMap[pc.listingId] = pc.verdict;
      }
    });

    const checkedTotal = Object.keys(verdictMap).length;
    const overpricedTotal = Object.values(verdictMap).filter(v => v === 'OVERPRICED').length;
    const underpricedTotal = Object.values(verdictMap).filter(v => v === 'UNDERPRICED').length;
    const atMarketTotal = Object.values(verdictMap).filter(v => ['MARKET PRICE', 'GOOD VALUE'].includes(v)).length;
    const totalAll = parseInt(totalListingsCount?.count || 0);

    return res.json({
      success: true,
      count: results.length,
      total,
      page: parseInt(page),
      totalPages,
      summary: {
        checked: checkedTotal,
        overpriced: overpricedTotal,
        underpriced: underpricedTotal,
        atMarket: atMarketTotal,
        unchecked: totalAll - checkedTotal,
        omitted: parseInt(omittedCount?.count || 0),
      },
      listings: results,
    });
  } catch (error) {
    console.error('Bulk price check error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /price-check/bulk
 * Run price check on multiple listings (processes sequentially to avoid rate limits)
 * Body: { listingIds: string[], forceRefresh: boolean }
 */
router.post('/bulk', async (req, res) => {
  try {
    const { listingIds, forceRefresh = false } = req.body;

    if (!listingIds || !Array.isArray(listingIds)) {
      return res.status(400).json({ success: false, error: 'listingIds array is required' });
    }

    // Limit to 20 at a time to prevent timeouts
    const idsToProcess = listingIds.slice(0, 20);
    const results = [];
    const errors = [];

    for (const listingId of idsToProcess) {
      try {
        const listing = await YourListing.query().findById(listingId);
        if (!listing) {
          errors.push({ listingId, error: 'Listing not found' });
          continue;
        }

        const result = await PriceCheckService.checkPrice(
          listingId,
          listing.title,
          parseFloat(listing.currentPrice),
          forceRefresh
        );

        // Calculate suggested price
        let suggestedPrice = null;
        if (result.metrics?.median) {
          suggestedPrice = Math.round(result.metrics.median * 0.95 * 100) / 100;
        }

        results.push({
          listingId,
          title: listing.title,
          currentPrice: parseFloat(listing.currentPrice),
          verdict: result.metrics?.verdict,
          marketMedian: result.metrics?.median,
          suggestedPrice,
          cached: result.cached,
        });

        // Small delay between requests to be nice to eBay
        if (!result.cached) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (err) {
        errors.push({ listingId, error: err.message });
      }
    }

    return res.json({
      success: true,
      processed: results.length,
      errors: errors.length,
      results,
      errorDetails: errors,
      remaining: listingIds.length - idsToProcess.length,
    });
  } catch (error) {
    console.error('Bulk price check error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /price-check/title
 * Run price check for an arbitrary title (not tied to a listing)
 * NOTE: Must be defined before /:listingId to avoid route collision
 */
router.post('/title', async (req, res) => {
  try {
    const { title, price } = req.body;

    if (!title || !price) {
      return res.status(400).json({ success: false, error: 'title and price are required' });
    }

    const result = await PriceCheckService.checkPrice(
      null, // no listing ID
      title,
      parseFloat(price),
      true // always run fresh for ad-hoc checks
    );

    return res.json({
      success: true,
      title,
      yourPrice: parseFloat(price),
      ...result,
    });
  } catch (error) {
    console.error('Price check error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /price-check/:listingId
 * Run price check for a specific listing
 */
router.post('/:listingId', async (req, res) => {
  try {
    const { listingId } = req.params;
    const { forceRefresh } = req.body;

    // Get the listing
    const listing = await YourListing.query().findById(listingId);
    if (!listing) {
      return res.status(404).json({ success: false, error: 'Listing not found' });
    }

    const result = await PriceCheckService.checkPrice(
      listingId,
      listing.title,
      parseFloat(listing.currentPrice),
      forceRefresh
    );

    return res.json({
      success: true,
      listingId,
      title: listing.title,
      yourPrice: parseFloat(listing.currentPrice),
      ...result,
    });
  } catch (error) {
    console.error('Price check error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /price-check/history/:listingId
 * Get price check history for a listing
 */
router.get('/history/:listingId', async (req, res) => {
  try {
    const { listingId } = req.params;
    const PriceCheck = require('../models/PriceCheck');

    const history = await PriceCheck.query()
      .where('listingId', listingId)
      .orderBy('checkedAt', 'desc')
      .limit(10);

    return res.json({
      success: true,
      history,
    });
  } catch (error) {
    console.error('Price check history error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /price-check/cron
 * Manually trigger the price check cron job
 * Query params: batchSize (default: 15)
 */
router.post('/cron', async (req, res) => {
  try {
    const { batchSize = 15 } = req.body;
    log.info({ batchSize }, 'Manually triggering price check cron');

    const runner = new PriceCheckCronRunner();

    // Run in background, don't await
    runner.work({ batchSize: parseInt(batchSize) });

    return res.json({
      success: true,
      message: `Price check cron started with batch size ${batchSize}`,
    });
  } catch (error) {
    console.error('Price check cron trigger error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /price-check/stats
 * Get stats on price check coverage
 */
router.get('/stats', async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [totalListings, recentChecks, allChecks] = await Promise.all([
      YourListing.query().where('listingStatus', 'Active').count('* as count').first(),
      PriceCheck.query().where('checkedAt', '>', cutoff).distinct('listingId').count('listingId as count').first(),
      PriceCheck.query().distinct('listingId').count('listingId as count').first(),
    ]);

    const total = parseInt(totalListings?.count || 0);
    const checkedLast24h = parseInt(recentChecks?.count || 0);
    const checkedEver = parseInt(allChecks?.count || 0);

    return res.json({
      success: true,
      stats: {
        totalActiveListings: total,
        checkedLast24h,
        checkedEver,
        unchecked: total - checkedEver,
        stale: checkedEver - checkedLast24h,
        coveragePercent: total > 0 ? Math.round((checkedEver / total) * 100) : 0,
        freshPercent: total > 0 ? Math.round((checkedLast24h / total) * 100) : 0,
      },
    });
  } catch (error) {
    console.error('Price check stats error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
