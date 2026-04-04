'use strict';

const { log } = require('../lib/logger');
const router = require('express-promise-router')();
const { isAdmin, authMiddleware } = require('../middleware/Middleware');
const YourDataManager = require('../managers/YourDataManager');
const SoldItemsManager = require('../managers/SoldItemsManager');
const SellerAPI = require('../ebay/SellerAPI');

// In-memory sync status (survives across requests, resets on dyno restart)
let syncStatus = {
  syncing: false,
  lastResult: null,
  lastSyncedAt: null,
  error: null,
};

/**
 * GET /sync/status
 * Get the current sync status
 */
router.get('/status', authMiddleware, async (req, res) => {
  res.json({ success: true, ...syncStatus });
});

/**
 * POST /sync/your-data
 * Sync your eBay orders and listings (runs in background, returns 202 immediately)
 * Body: { daysBack: number } (optional, default: 365)
 */
router.post('/your-data', authMiddleware, isAdmin, async (req, res, next) => {
  if (syncStatus.syncing) {
    return res.status(409).json({
      success: false,
      message: 'Sync already in progress',
    });
  }

  log.info('Starting sync of your eBay data');
  const { daysBack = 365 } = req.body || {};

  syncStatus.syncing = true;
  syncStatus.error = null;

  // Return immediately — sync runs in background
  res.status(202).json({
    success: true,
    message: 'Sync started',
  });

  // Run sync in background
  try {
    const manager = new YourDataManager();
    const results = await manager.syncAll({ daysBack });

    log.info({ results }, 'Completed sync of your eBay data');
    syncStatus.lastResult = results;
    syncStatus.lastSyncedAt = new Date().toISOString();
    syncStatus.error = null;
  } catch (err) {
    log.error({ err }, 'Error syncing your eBay data');
    syncStatus.error = err.message;
  } finally {
    syncStatus.syncing = false;
  }
});

/**
 * POST /sync/your-orders
 * Sync only your eBay orders
 * Body: { daysBack: number } (optional, default: 365)
 */
router.post('/your-orders', authMiddleware, isAdmin, async (req, res, next) => {
  log.info('Starting sync of your eBay orders');

  const { daysBack = 365 } = req.body || {};

  try {
    const manager = new YourDataManager();
    const results = await manager.syncOrders({ daysBack });

    log.info({ results }, 'Completed sync of your eBay orders');
    res.json({
      success: true,
      message: 'Order sync completed',
      results,
    });
  } catch (err) {
    log.error({ err }, 'Error syncing your eBay orders');
    res.status(500).json({
      success: false,
      message: 'Order sync failed',
      error: err.message,
    });
  }
});

/**
 * POST /sync/your-listings
 * Sync only your eBay listings
 */
router.post('/your-listings', authMiddleware, isAdmin, async (req, res, next) => {
  log.info('Starting sync of your eBay listings');

  try {
    const manager = new YourDataManager();
    const results = await manager.syncListings();

    log.info({ results }, 'Completed sync of your eBay listings');
    res.json({
      success: true,
      message: 'Listings sync completed',
      results,
    });
  } catch (err) {
    log.error({ err }, 'Error syncing your eBay listings');
    res.status(500).json({
      success: false,
      message: 'Listings sync failed',
      error: err.message,
    });
  }
});

/**
 * POST /sync/sold-items
 * Scrape sold items from all enabled competitors
 * Body: { categoryId: string, maxPagesPerSeller: number, enrichCompatibility: boolean }
 */
router.post('/sold-items', authMiddleware, isAdmin, async (req, res, next) => {
  log.info('Starting scrape of sold items from competitors');

  const {
    categoryId = '35596',
    maxPagesPerSeller = 5,
    enrichCompatibility = false,
  } = req.body || {};

  try {
    const manager = new SoldItemsManager();
    const results = await manager.scrapeAllCompetitors({
      categoryId,
      maxPagesPerSeller,
      enrichCompatibility,
    });

    log.info({ results }, 'Completed scraping sold items');
    res.json({
      success: true,
      message: 'Scrape completed',
      results,
    });
  } catch (err) {
    log.error({ err }, 'Error scraping sold items');
    res.status(500).json({
      success: false,
      message: 'Scrape failed',
      error: err.message,
    });
  }
});

/**
 * POST /sync/sold-items/:seller
 * Scrape sold items from a specific seller
 * Params: seller - seller username
 * Body: { categoryId: string, maxPages: number, enrichCompatibility: boolean }
 */
router.post('/sold-items/:seller', authMiddleware, isAdmin, async (req, res, next) => {
  const { seller } = req.params;
  log.info({ seller }, 'Starting scrape of sold items from specific seller');

  const {
    categoryId = '35596',
    maxPages = 5,
    enrichCompatibility = false,
  } = req.body || {};

  try {
    const manager = new SoldItemsManager();
    const results = await manager.scrapeCompetitor({
      seller,
      categoryId,
      maxPages,
      enrichCompatibility,
    });

    log.info({ seller, results }, 'Completed scraping sold items from seller');
    res.json({
      success: true,
      message: 'Scrape completed',
      seller,
      results,
    });
  } catch (err) {
    log.error({ err, seller }, 'Error scraping sold items from seller');
    res.status(500).json({
      success: false,
      message: 'Scrape failed',
      error: err.message,
    });
  }
});

/**
 * POST /sync/sold-items-by-keywords
 * Scrape sold items by keyword search (market research)
 * Body: { keywords: string, categoryId: string, maxPages: number }
 */
router.post('/sold-items-by-keywords', authMiddleware, isAdmin, async (req, res, next) => {
  const { keywords, categoryId = '35596', maxPages = 5 } = req.body || {};

  if (!keywords) {
    return res.status(400).json({
      success: false,
      message: 'Keywords are required',
    });
  }

  log.info({ keywords, categoryId, maxPages }, 'Starting keyword-based sold items scrape');

  try {
    const manager = new SoldItemsManager();
    const results = await manager.scrapeByKeywords({
      keywords,
      categoryId,
      maxPages,
    });

    log.info({ keywords, results }, 'Completed keyword-based scraping');
    res.json({
      success: true,
      message: 'Keyword scrape completed',
      keywords,
      results,
    });
  } catch (err) {
    log.error({ err, keywords }, 'Error scraping by keywords');
    res.status(500).json({
      success: false,
      message: 'Keyword scrape failed',
      error: err.message,
    });
  }
});

/**
 * GET /sync/your-listings
 * Get your synced listings with pagination
 * Query params: page (default: 1), limit (default: 50), status (optional filter)
 */
router.get('/your-listings', authMiddleware, async (req, res, next) => {
  try {
    const YourListing = require('../models/YourListing');
    const { page = 1, limit = 50, status } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = YourListing.query();

    if (status) {
      query = query.where('listingStatus', status);
    }

    const [listings, countResult] = await Promise.all([
      query.clone().orderBy('createdAt', 'desc').limit(parseInt(limit)).offset(offset),
      query.clone().count('* as total').first(),
    ]);

    const total = parseInt(countResult?.total || 0);
    const totalPages = Math.ceil(total / parseInt(limit));

    // Calculate daysListed for each listing
    const now = new Date();
    const listingsWithDays = listings.map(listing => {
      const startTime = listing.startTime ? new Date(listing.startTime) : now;
      const daysListed = Math.floor((now - startTime) / (1000 * 60 * 60 * 24));
      return {
        ...listing,
        daysListed: Math.max(0, daysListed),
      };
    });

    res.json({
      success: true,
      count: listingsWithDays.length,
      total,
      page: parseInt(page),
      totalPages,
      listings: listingsWithDays,
    });
  } catch (err) {
    log.error({ err }, 'Error fetching your listings');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /sync/your-sales/trends
 * Get sales trends aggregated by day/week
 * Query params: period (daily/weekly), daysBack (default: 90)
 * NOTE: This route MUST come before /your-sales to avoid route conflicts
 */
router.get('/your-sales/trends', authMiddleware, async (req, res, next) => {
  try {
    const { period = 'daily', daysBack = 90 } = req.query;
    const YourSale = require('../models/YourSale');
    const { raw } = require('objection');

    const cutoff = new Date(Date.now() - parseInt(daysBack) * 24 * 60 * 60 * 1000);

    let groupBy, dateFormat;
    if (period === 'weekly') {
      // Group by week (ISO week)
      groupBy = raw("DATE_TRUNC('week', \"soldDate\")");
      dateFormat = "DATE_TRUNC('week', \"soldDate\")";
    } else {
      // Group by day
      groupBy = raw("DATE_TRUNC('day', \"soldDate\")");
      dateFormat = "DATE_TRUNC('day', \"soldDate\")";
    }

    const trends = await YourSale.query()
      .select(
        raw(`${dateFormat} as "date"`),
        raw('COUNT(*) as "count"'),
        raw('SUM("salePrice") as "revenue"'),
        raw('AVG("salePrice") as "avgPrice"')
      )
      .where('soldDate', '>=', cutoff)
      .groupByRaw(dateFormat)
      .orderBy('date', 'asc');

    // Calculate totals
    const totalRevenue = trends.reduce((sum, t) => sum + parseFloat(t.revenue || 0), 0);
    const totalCount = trends.reduce((sum, t) => sum + parseInt(t.count || 0), 0);

    res.json({
      success: true,
      period,
      daysBack: parseInt(daysBack),
      trends: trends.map(t => ({
        date: t.date,
        count: parseInt(t.count),
        revenue: parseFloat(t.revenue).toFixed(2),
        avgPrice: parseFloat(t.avgPrice).toFixed(2),
      })),
      totals: {
        count: totalCount,
        revenue: totalRevenue.toFixed(2),
        avgPrice: totalCount > 0 ? (totalRevenue / totalCount).toFixed(2) : '0.00',
      },
    });
  } catch (err) {
    log.error({ err }, 'Error fetching sales trends');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /sync/your-sales
 * Get your synced sales with pagination
 * Query params: page (default: 1), limit (default: 50), daysBack (optional filter)
 */
router.get('/your-sales', authMiddleware, async (req, res, next) => {
  try {
    const YourSale = require('../models/YourSale');
    const { page = 1, limit = 50, daysBack } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = YourSale.query();

    if (daysBack) {
      const cutoff = new Date(Date.now() - parseInt(daysBack) * 24 * 60 * 60 * 1000);
      query = query.where('soldDate', '>=', cutoff);
    }

    const [sales, countResult] = await Promise.all([
      query.clone().orderBy('soldDate', 'desc').limit(parseInt(limit)).offset(offset),
      query.clone().count('* as total').first(),
    ]);

    const total = parseInt(countResult?.total || 0);
    const totalPages = Math.ceil(total / parseInt(limit));

    res.json({
      success: true,
      count: sales.length,
      total,
      page: parseInt(page),
      totalPages,
      sales,
    });
  } catch (err) {
    log.error({ err }, 'Error fetching your sales');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /sync/health
 * Test eBay API connectivity
 */
router.get('/health', async (req, res, next) => {
  try {
    const api = new SellerAPI();
    const result = await api.healthCheck();

    if (result.success) {
      res.json({
        success: true,
        message: 'eBay API is connected',
        sellerId: result.sellerId,
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'eBay API check failed',
        error: result.error,
      });
    }
  } catch (err) {
    log.error({ err }, 'Error checking eBay API health');
    res.status(500).json({
      success: false,
      message: 'Health check failed',
      error: err.message,
    });
  }
});

/**
 * GET /sync/stats
 * Get sync statistics
 */
router.get('/stats', authMiddleware, async (req, res, next) => {
  try {
    const yourDataManager = new YourDataManager();
    const soldItemsManager = new SoldItemsManager();

    const [yourStats, soldStats] = await Promise.all([
      yourDataManager.getStats(),
      soldItemsManager.getStats(),
    ]);

    res.json({
      success: true,
      yourData: yourStats,
      soldItems: soldStats,
    });
  } catch (err) {
    log.error({ err }, 'Error getting sync stats');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * POST /sync/build-auto-index
 * Build Auto + AutoItemCompatibility from Item._year/_make/_model fields.
 * The Item table has 21K items with year/make/model parsed from titles,
 * but the Auto table (used by search dropdowns) is empty.
 * This creates Auto records and links them to Items.
 */
router.post('/build-auto-index', async (req, res) => {
  const { database } = require('../database/database');
  const { v4: uuidv4 } = require('uuid');

  try {
    // Get all items - the _year, _make, _model fields were in the JSON export
    // but the Item table doesn't have those columns. We need to parse from title.
    // Actually, check if those columns exist first:
    let items;
    try {
      items = await database('Item')
        .whereNotNull('title')
        .select('id', 'ebayId', 'title')
        .limit(50000);
    } catch (e) {
      return res.status(500).json({ error: 'Could not query Item table: ' + e.message });
    }

    // Parse year/make/model from titles
    const MAKES = ['Acura','Audi','BMW','Buick','Cadillac','Chevrolet','Chevy','Chrysler','Dodge','Fiat','Ford','Genesis','GMC','Honda','Hummer','Hyundai','Infiniti','Isuzu','Jaguar','Jeep','Kia','Land Rover','Lexus','Lincoln','Maserati','Mazda','Mercedes-Benz','Mercedes','Mercury','Mini','Mitsubishi','Nissan','Oldsmobile','Pontiac','Porsche','Ram','Saab','Saturn','Scion','Smart','Subaru','Suzuki','Toyota','Volkswagen','VW','Volvo'];

    const autoCache = {}; // "year|make|model|engine" → autoId
    let autosCreated = 0, linksCreated = 0, skipped = 0;

    for (const item of items) {
      const title = item.title || '';
      // Extract year
      const yearMatch = title.match(/\b((?:19|20)\d{2})\b/);
      if (!yearMatch) { skipped++; continue; }
      const year = parseInt(yearMatch[1]);

      // Extract make
      let make = null;
      const titleUpper = title.toUpperCase();
      for (const m of MAKES) {
        if (titleUpper.includes(m.toUpperCase())) { make = m; break; }
      }
      if (!make) { skipped++; continue; }
      // Normalize Chevy → Chevrolet, VW → Volkswagen
      if (make === 'Chevy') make = 'Chevrolet';
      if (make === 'VW') make = 'Volkswagen';
      if (make === 'Mercedes') make = 'Mercedes-Benz';

      // Extract model: words after make until year/part keywords
      const makeIdx = titleUpper.indexOf(make.toUpperCase());
      const afterMake = title.substring(makeIdx + make.length).trim();
      const words = afterMake.split(/\s+/);
      const modelWords = [];
      for (const w of words) {
        if (/^\d{4}$/.test(w)) break;
        if (/^\d+\.\d+[lL]$/.test(w)) break;
        if (/^(ECU|ECM|PCM|BCM|TCM|ABS|TIPM|OEM|Engine|Body|Control|Module|Anti|Fuse|Power|Brake)$/i.test(w)) break;
        modelWords.push(w);
        if (modelWords.length >= 3) break;
      }
      if (modelWords.length === 0) { skipped++; continue; }
      const model = modelWords.join(' ').replace(/[^A-Za-z0-9 \-]/g, '').trim();
      if (!model) { skipped++; continue; }

      const engine = 'N/A';
      const autoKey = `${year}|${make}|${model}|${engine}`;

      // Get or create Auto
      let autoId = autoCache[autoKey];
      if (!autoId) {
        const existing = await database('Auto')
          .where({ year, make, model, engine }).first();
        if (existing) {
          autoId = existing.id;
        } else {
          autoId = uuidv4();
          try {
            await database('Auto').insert({
              id: autoId, year, make, model, trim: '', engine,
              createdAt: new Date(), updatedAt: new Date(),
            });
            autosCreated++;
          } catch (e) {
            if (e.message?.includes('duplicate') || e.message?.includes('unique')) {
              const found = await database('Auto').where({ year, make, model, engine }).first();
              autoId = found?.id || autoId;
            } else { skipped++; continue; }
          }
        }
        autoCache[autoKey] = autoId;
      }

      // Create AutoItemCompatibility link
      try {
        const linkExists = await database('AutoItemCompatibility')
          .where({ autoId, itemId: item.ebayId }).first();
        if (!linkExists) {
          await database('AutoItemCompatibility').insert({ autoId, itemId: item.ebayId });
          linksCreated++;
        }
      } catch (e) {
        // Ignore duplicate links
      }
    }

    // Verify counts
    const autoCount = await database('Auto').count('* as cnt').first();
    const linkCount = await database('AutoItemCompatibility').count('* as cnt').first();

    res.json({
      success: true,
      itemsProcessed: items.length,
      autosCreated,
      linksCreated,
      skipped,
      totalAutos: parseInt(autoCount?.cnt || 0),
      totalLinks: parseInt(linkCount?.cnt || 0),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /sync/import-items
 * Bulk import competitor/reference items.
 * Body: { records: [...] }
 */
router.post('/import-items', async (req, res) => {
  const { records } = req.body;
  if (!records || !Array.isArray(records)) return res.status(400).json({ error: 'records array required' });

  const { database } = require('../database/database');
  const { normalizePartNumber } = require('../lib/partNumberUtils');
  let imported = 0, skipped = 0, errors = 0;

  for (const r of records) {
    if (!r.ebayId) { errors++; continue; }
    try {
      const existing = await database('Item').where('ebayId', r.ebayId).first();
      if (existing) { skipped++; continue; }
      const partBase = r.manufacturerPartNumber ? normalizePartNumber(r.manufacturerPartNumber) : null;
      await database('Item').insert({
        id: r.id || r.ebayId,
        ebayId: r.ebayId,
        price: parseFloat(r.price) || 0,
        quantity: parseInt(r.quantity) || 1,
        title: r.title || null,
        categoryId: r.categoryId || '',
        categoryTitle: r.categoryTitle || '',
        seller: r.seller || '',
        manufacturerPartNumber: r.manufacturerPartNumber || null,
        manufacturerId: r.manufacturerId || null,
        pictureUrl: r.pictureUrl || null,
        processed: r.processed === true || r.processed === 'true',
        partNumberBase: partBase,
        createdAt: r.createdAt ? new Date(r.createdAt) : new Date(),
        updatedAt: r.updatedAt ? new Date(r.updatedAt) : new Date(),
      });
      imported++;
    } catch (err) {
      if (err.message?.includes('duplicate') || err.message?.includes('unique')) skipped++;
      else errors++;
    }
  }
  res.json({ success: true, imported, skipped, errors, total: records.length });
});

/**
 * POST /sync/import-sales
 * Bulk import sales records from JSON body.
 * Body: { records: [...] } — array of sale objects
 */
router.post('/import-sales', async (req, res) => {
  const { records } = req.body;
  if (!records || !Array.isArray(records)) {
    return res.status(400).json({ error: 'records array required' });
  }

  const { database } = require('../database/database');
  let imported = 0, skipped = 0, errors = 0;

  for (const r of records) {
    const orderId = r.ebayOrderId || r.orderId || r.orderNumber;
    if (!orderId) { errors++; continue; }
    try {
      const existing = await database('YourSale').where('ebayOrderId', orderId).first();
      if (existing) { skipped++; continue; }
      await database('YourSale').insert({
        ebayOrderId: orderId,
        ebayItemId: r.ebayItemId || r.itemId || null,
        title: r.title || null,
        sku: r.sku || r.customLabel || null,
        quantity: parseInt(r.quantity) || 1,
        salePrice: parseFloat(r.salePrice || r.price || 0) || null,
        soldDate: r.soldDate ? new Date(r.soldDate) : null,
        buyerUsername: r.buyerUsername || r.buyer || null,
        shippedDate: r.shippedDate ? new Date(r.shippedDate) : null,
        store: r.store || 'dynatrack',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      imported++;
    } catch (err) {
      if (err.message?.includes('duplicate') || err.message?.includes('unique')) skipped++;
      else errors++;
    }
  }

  res.json({ success: true, imported, skipped, errors, total: records.length });
});

/**
 * POST /sync/import-listings
 * Bulk import listing records from JSON body.
 * Body: { records: [...] } — array of listing objects
 */
router.post('/import-listings', async (req, res) => {
  const { records } = req.body;
  if (!records || !Array.isArray(records)) {
    return res.status(400).json({ error: 'records array required' });
  }

  const { database } = require('../database/database');
  const store = (records[0]?.store || 'dynatrack').toLowerCase().trim();
  let imported = 0, updated = 0, errors = 0;
  const uploadedIds = [];

  for (const r of records) {
    const itemId = r.ebayItemId || r.itemId;
    if (!itemId) { errors++; continue; }
    uploadedIds.push(String(itemId));

    const qty = parseInt(r.quantityAvailable || r.quantity) || 0;
    const status = qty > 0 ? (r.listingStatus || r.status || 'Active') : 'Ended';

    try {
      const existing = await database('YourListing').where('ebayItemId', itemId).first();
      if (existing) {
        const upd = {
          title: r.title || existing.title,
          sku: r.sku || existing.sku,
          quantityAvailable: qty || existing.quantityAvailable,
          currentPrice: parseFloat(r.currentPrice || r.price || 0) || existing.currentPrice,
          listingStatus: status,
          startTime: r.startTime ? new Date(r.startTime) : existing.startTime,
          viewItemUrl: r.viewItemUrl || r.url || existing.viewItemUrl,
          syncedAt: new Date(),
          updatedAt: new Date(),
        };
        if (r.store) upd.store = r.store.toLowerCase().trim();
        await database('YourListing').where('ebayItemId', itemId).update(upd);
        updated++;
        continue;
      }
      await database('YourListing').insert({
        ebayItemId: itemId,
        title: r.title || null,
        sku: r.sku || null,
        quantityAvailable: qty || 1,
        currentPrice: parseFloat(r.currentPrice || r.price || 0) || null,
        listingStatus: status,
        startTime: r.startTime ? new Date(r.startTime) : new Date(),
        viewItemUrl: r.viewItemUrl || r.url || null,
        store: r.store ? r.store.toLowerCase().trim() : 'dynatrack',
        syncedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      imported++;
    } catch (err) {
      if (err.message?.includes('duplicate') || err.message?.includes('unique')) updated++;
      else errors++;
    }
  }

  // Deactivation pass: end listings in this store that weren't in the upload
  let deactivated = 0;
  if (uploadedIds.length > 0 && store) {
    try {
      deactivated = await database('YourListing')
        .where('store', store)
        .where('listingStatus', 'Active')
        .whereNotIn('ebayItemId', uploadedIds)
        .update({ listingStatus: 'Ended', updatedAt: new Date() });
      if (deactivated > 0) {
        log.info({ store, deactivated }, 'CSV import: deactivated listings missing from file');
      }
    } catch (e) {
      log.warn({ err: e.message }, 'CSV import: deactivation pass failed');
    }
  }

  res.json({ success: true, imported, updated, deactivated, errors, total: records.length });
});

/**
 * POST /sync/configure-ebay
 * Set eBay Trading API credentials at runtime (persists until next deploy).
 * Body: { devName, appName, certName, token }
 */
router.post('/configure-ebay', async (req, res) => {
  const { devName, appName, certName, token } = req.body || {};
  const set = [];
  if (devName)  { process.env.TRADING_API_DEV_NAME  = devName;  set.push('TRADING_API_DEV_NAME'); }
  if (appName)  { process.env.TRADING_API_APP_NAME  = appName;  set.push('TRADING_API_APP_NAME'); }
  if (certName) { process.env.TRADING_API_CERT_NAME = certName; set.push('TRADING_API_CERT_NAME'); }
  if (token)    { process.env.TRADING_API_TOKEN      = token;    set.push('TRADING_API_TOKEN'); }

  if (set.length === 0) {
    return res.status(400).json({ error: 'Provide at least one of: devName, appName, certName, token' });
  }

  // Test the connection
  const api = new SellerAPI();
  const health = await api.healthCheck().catch(e => ({ success: false, error: e.message }));

  res.json({
    success: true,
    configured: set,
    ebayConnected: health.success,
    sellerId: health.sellerId || null,
    error: health.error || null,
    note: 'These are set in memory only — add them as Railway env vars to persist across deploys.',
  });
});

/**
 * GET /sync/ebay-status
 * Quick check: are eBay credentials configured?
 */
router.get('/ebay-status', async (req, res) => {
  const configured = {
    TRADING_API_DEV_NAME: !!process.env.TRADING_API_DEV_NAME,
    TRADING_API_APP_NAME: !!process.env.TRADING_API_APP_NAME,
    TRADING_API_CERT_NAME: !!process.env.TRADING_API_CERT_NAME,
    TRADING_API_TOKEN: !!process.env.TRADING_API_TOKEN,
  };
  const allSet = Object.values(configured).every(Boolean);

  let health = null;
  if (allSet) {
    const api = new SellerAPI();
    health = await api.healthCheck().catch(e => ({ success: false, error: e.message }));
  }

  // Get data freshness
  let dataStatus = {};
  try {
    const { database } = require('../database/database');
    const sales = await database.raw('SELECT COUNT(*) as total, MAX("soldDate") as newest FROM "YourSale"');
    const listings = await database.raw('SELECT COUNT(*) as active, MAX("syncedAt") as synced FROM "YourListing" WHERE "listingStatus" = \'Active\'');
    const newest = sales.rows[0]?.newest;
    const hoursOld = newest ? Math.floor((Date.now() - new Date(newest).getTime()) / 3600000) : null;
    dataStatus = {
      salesTotal: parseInt(sales.rows[0]?.total || 0),
      newestSale: newest,
      salesHoursOld: hoursOld,
      activeListings: parseInt(listings.rows[0]?.active || 0),
      listingsLastSynced: listings.rows[0]?.synced,
    };
  } catch (e) { dataStatus = { error: e.message }; }

  res.json({
    success: true,
    credentials: configured,
    allCredentialsSet: allSet,
    ebayHealth: health,
    dataStatus,
    instructions: allSet ? null : 'Set eBay credentials via POST /sync/configure-ebay or as Railway env vars: TRADING_API_DEV_NAME, TRADING_API_APP_NAME, TRADING_API_CERT_NAME, TRADING_API_TOKEN. Get these from https://developer.ebay.com/my/keys',
  });
});

/**
 * POST /sync/trigger
 * Quick trigger: sync orders + listings right now. No auth needed.
 */
router.post('/trigger', async (req, res) => {
  if (!process.env.TRADING_API_TOKEN) {
    return res.status(400).json({
      success: false,
      error: 'eBay credentials not configured. POST /sync/configure-ebay first, or set TRADING_API_TOKEN as a Railway env var.',
      help: 'GET /sync/ebay-status to see what is missing.',
    });
  }

  const { daysBack = 30 } = req.body || {};
  log.info({ daysBack }, 'Manual sync triggered via /sync/trigger');

  // Return immediately, run in background
  res.json({ success: true, message: 'Sync started in background', daysBack });

  try {
    const manager = new YourDataManager();
    const results = await manager.syncAll({ daysBack });
    log.info({ results }, 'Manual trigger sync completed');
  } catch (err) {
    log.error({ err }, 'Manual trigger sync failed');
  }
});

module.exports = router;
