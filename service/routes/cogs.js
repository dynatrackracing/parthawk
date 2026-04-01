'use strict';

const router = require('express-promise-router')();
const COGSService = require('../services/COGSService');
const { database } = require('../database/database');
const { v4: uuidv4 } = require('uuid');
const { log } = require('../lib/logger');
const { extractPartNumbers, stripRevisionSuffix } = require('../utils/partIntelligence');

/**
 * POST /cogs/gate
 * Calculate max spend for gate negotiation
 * Body: { yardId, parts: [{ partType, marketValue }] }
 */
router.post('/gate', async (req, res) => {
  try {
    const { yardId, parts } = req.body;
    if (!yardId || !parts?.length) {
      return res.status(400).json({ error: 'yardId and parts required' });
    }
    const result = await COGSService.calculateGateMax(yardId, parts);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /cogs/session
 * Record a pull session with full true COGS calculation
 */
router.post('/session', async (req, res) => {
  try {
    const { yardId, parts, totalPaid, pullerId, notes } = req.body;
    if (!yardId || !parts?.length || totalPaid === undefined) {
      return res.status(400).json({ error: 'yardId, parts, and totalPaid required' });
    }

    const calculation = await COGSService.calculateSession({ yardId, parts, totalPaid });
    const { session } = calculation;

    // Save session to database
    const sessionId = uuidv4();
    await database('pull_session').insert({
      id: sessionId,
      yard_id: yardId,
      puller_id: pullerId || null,
      date: new Date(),
      parts_cost: totalPaid,
      gate_fee: session.entryFee,
      tax_paid: 0,
      total_true_cogs: session.totalTrueCost,
      total_market_value: session.totalMarketValue,
      blended_cogs_pct: session.blendedCogsRate,
      notes: notes || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).catch(err => {
      log.warn({ err: err.message }, 'Could not save pull session - table may not exist yet');
    });

    res.json({ success: true, sessionId, ...calculation });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /cogs/yard-profile/:yardId
 * Get yard profile with COGS reference for the gate negotiation screen
 */
router.get('/yard-profile/:yardId', async (req, res) => {
  try {
    const profile = await COGSService.getYardProfile(req.params.yardId);
    res.json({ success: true, ...profile });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /cogs/yards
 * Get all yards with their cost profiles for gate negotiation UI
 */
router.get('/yards', async (req, res) => {
  try {
    const yards = await database('yard')
      .where('enabled', true)
      .where(function() { this.where('flagged', false).orWhereNull('flagged'); })
      .select('id', 'name', 'chain', 'distance_from_base', 'entry_fee', 'visit_frequency')
      .orderBy('distance_from_base', 'asc');

    const BASE_ADDRESSES = {
      nc: 'Hillsborough, NC',
      fl: '7413 S O\'Brien St, Tampa, FL 33616',
    };

    const yardsWithCalc = yards.map(y => ({
      ...y,
      region: y.region || 'nc',
      base_address: BASE_ADDRESSES[y.region || 'nc'] || BASE_ADDRESSES.nc,
      fixed_overhead: parseFloat(y.entry_fee || 0),
    }));

    res.json({ success: true, yards: yardsWithCalc });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /cogs/check-stock?pn={partNumber}
 * Check if a part number is in our active eBay inventory
 */
router.get('/check-stock', async (req, res) => {
  try {
    const rawPN = (req.query.pn || '').trim();
    if (!rawPN || rawPN.length < 4) {
      return res.status(400).json({ error: 'Part number must be at least 4 characters.' });
    }

    const searchUpper = rawPN.toUpperCase();
    const searchCompressed = searchUpper.replace(/[-\s.]/g, '');
    const searchBase = stripRevisionSuffix(searchCompressed);

    // 1. Exact match: search YourListing titles for this PN (case-insensitive)
    const exactListings = await database('YourListing')
      .where('listingStatus', 'Active')
      .where(function() {
        this.where('title', 'ilike', `%${searchUpper}%`);
        // Also search compressed form (no dashes)
        if (searchCompressed !== searchUpper) {
          this.orWhere('title', 'ilike', `%${searchCompressed}%`);
        }
        // Also try with common dash patterns
        if (rawPN.includes('-')) {
          const noDash = rawPN.replace(/-/g, '');
          this.orWhere('title', 'ilike', `%${noDash}%`);
        } else if (searchCompressed.length >= 8) {
          // Try matching even if listed with dashes
          this.orWhere('title', 'ilike', `%${searchCompressed}%`);
        }
        // Also check SKU
        this.orWhere('sku', 'ilike', `%${searchUpper}%`);
      })
      .select('ebayItemId', 'title', 'currentPrice', 'quantityAvailable', 'sku', 'store')
      .limit(20);

    const exactResults = exactListings.map(l => ({
      ebayItemId: l.ebayItemId,
      title: l.title,
      currentPrice: parseFloat(l.currentPrice) || null,
      quantity: parseInt(l.quantityAvailable) || 1,
      store: l.store || 'dynatrack',
      matchType: 'EXACT',
    }));
    const exactItemIds = new Set(exactResults.map(r => r.ebayItemId));

    // 2. Variant match: search for same base PN, different suffix
    let variantResults = [];
    if (searchBase && searchBase.length >= 6 && searchBase !== searchCompressed) {
      const variantListings = await database('YourListing')
        .where('listingStatus', 'Active')
        .where('title', 'ilike', `%${searchBase}%`)
        .select('ebayItemId', 'title', 'currentPrice', 'quantityAvailable', 'store')
        .limit(30);

      for (const l of variantListings) {
        if (exactItemIds.has(l.ebayItemId)) continue;
        // Verify this listing actually contains a PN with the same base
        const listingPNs = extractPartNumbers(l.title);
        const hasVariant = listingPNs.some(pn => {
          const pnBase = stripRevisionSuffix(pn.normalized);
          return pnBase === searchBase && pn.normalized !== searchCompressed;
        });
        if (hasVariant) {
          const matchedPN = listingPNs.find(pn => stripRevisionSuffix(pn.normalized) === searchBase);
          const suffix = matchedPN ? matchedPN.normalized.slice(searchBase.length) : '';
          const searchSuffix = searchCompressed.slice(searchBase.length);
          variantResults.push({
            ebayItemId: l.ebayItemId,
            title: l.title,
            currentPrice: parseFloat(l.currentPrice) || null,
            quantity: parseInt(l.quantityAvailable) || 1,
            store: l.store || 'dynatrack',
            matchType: 'VARIANT',
            variantNote: `Same base, different suffix (${suffix || '?'} vs ${searchSuffix || '?'})`,
          });
        }
      }
    }

    // 3. Check overstock groups
    let overstock = null;
    try {
      const allMatchIds = [...exactResults, ...variantResults].map(r => r.ebayItemId);
      if (allMatchIds.length > 0) {
        const trackedItem = await database('overstock_group_item')
          .whereIn('ebay_item_id', allMatchIds)
          .first();
        if (trackedItem) {
          const group = await database('overstock_group')
            .where('id', trackedItem.group_id)
            .first();
          if (group) {
            overstock = {
              tracked: true,
              groupName: group.name,
              currentStock: group.current_stock,
              restockTarget: group.restock_target,
            };
          }
        }
      }
    } catch (e) { /* overstock tables may not exist */ }

    res.json({
      searchPN: searchUpper,
      exact: exactResults,
      variants: variantResults,
      totalExact: exactResults.length,
      totalVariants: variantResults.length,
      overstock,
    });
  } catch (err) {
    res.status(500).json({ error: 'Stock check failed: ' + err.message });
  }
});

module.exports = router;
