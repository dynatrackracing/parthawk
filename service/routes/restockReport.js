'use strict';

/**
 * restockReport.js — GET /restock/report
 *
 * Generates a restock report with three tiers:
 *   Green: restock NOW (sold >= 3x stock in 90d, high demand)
 *   Yellow: maybe restock (sold >= 2x stock, moderate demand)
 *   Grey: on radar (sold >= stock, low priority)
 */

const router = require('express-promise-router')();
const { database } = require('../database/database');
const { normalizePartNumber } = require('../lib/partNumberUtils');

async function generateRestockReport() {
  const cutoff90 = new Date(Date.now() - 90 * 86400000);

  // Get all sales grouped by SKU in last 90 days
  const sales = await database('YourSale')
    .where('soldDate', '>=', cutoff90)
    .whereNotNull('sku')
    .where('sku', '!=', '')
    .select('sku', 'title', 'salePrice', 'soldDate');

  // Group by normalized part number
  const salesByPart = {};
  for (const sale of sales) {
    const base = normalizePartNumber(sale.sku) || sale.sku;
    if (!salesByPart[base]) {
      salesByPart[base] = { sku: sale.sku, title: sale.title, sold: 0, revenue: 0, prices: [] };
    }
    salesByPart[base].sold++;
    const price = parseFloat(sale.salePrice) || 0;
    salesByPart[base].revenue += price;
    salesByPart[base].prices.push(price);
  }

  // Get active stock counts
  const listings = await database('YourListing')
    .where('listingStatus', 'Active')
    .whereNotNull('sku')
    .select('sku', 'quantityAvailable', 'currentPrice');

  const stockByPart = {};
  for (const listing of listings) {
    const base = normalizePartNumber(listing.sku) || listing.sku;
    stockByPart[base] = (stockByPart[base] || 0) + (parseInt(listing.quantityAvailable) || 1);
  }

  // Build report
  const green = []; // restock NOW
  const yellow = []; // maybe
  const grey = []; // on radar

  for (const [base, data] of Object.entries(salesByPart)) {
    const stock = stockByPart[base] || 0;
    const avgPrice = data.sold > 0 ? Math.round(data.revenue / data.sold * 100) / 100 : 0;
    const ratio = stock > 0 ? data.sold / stock : data.sold; // sold-to-stock ratio

    const entry = {
      partNumber: data.sku,
      partNumberBase: base,
      title: data.title,
      sold90d: data.sold,
      activeStock: stock,
      avgPrice,
      revenue90d: Math.round(data.revenue),
      ratio: Math.round(ratio * 10) / 10,
    };

    if (data.sold >= 3 * Math.max(stock, 1) && data.sold >= 3) {
      entry.tier = 'green';
      entry.action = 'RESTOCK NOW';
      green.push(entry);
    } else if (data.sold >= 2 * Math.max(stock, 1) && data.sold >= 2) {
      entry.tier = 'yellow';
      entry.action = 'CONSIDER';
      yellow.push(entry);
    } else if (data.sold >= Math.max(stock, 1)) {
      entry.tier = 'grey';
      entry.action = 'ON RADAR';
      grey.push(entry);
    }
  }

  // Sort each tier by revenue descending
  green.sort((a, b) => b.revenue90d - a.revenue90d);
  yellow.sort((a, b) => b.revenue90d - a.revenue90d);
  grey.sort((a, b) => b.revenue90d - a.revenue90d);

  return { green, yellow, grey, summary: { greenCount: green.length, yellowCount: yellow.length, greyCount: grey.length, totalParts: Object.keys(salesByPart).length } };
}

// JSON API
router.get('/report', async (req, res) => {
  try {
    const report = await generateRestockReport();
    res.json({ success: true, ...report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.generateRestockReport = generateRestockReport;
