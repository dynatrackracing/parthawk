'use strict';

const router = require('express-promise-router')();
const { database } = require('../database/database');
const { matchPartToListings, matchPartToSales, matchPartToYardVehicles, parseTitle } = require('../utils/partMatcher');

// Diagnostic endpoint
router.get('/debug/:id', async (req, res) => {
  const item = await database('restock_want_list').where({ id: req.params.id }).first();
  if (!item) return res.status(404).json({ error: 'Not found' });

  const listings = await matchPartToListings(item.title);
  const sales = await matchPartToSales(item.title);
  const parsed = parseTitle(item.title);

  res.json({ wantTitle: item.title, parsed, listings, sales });
});

// Get all active want list items with stock counts and sale data
router.get('/items', async (req, res) => {
  const items = await database('restock_want_list').where({ active: true }).orderBy('created_at', 'asc');

  const results = [];
  for (const item of items) {
    const listings = await matchPartToListings(item.title);
    const sales = await matchPartToSales(item.title);

    results.push({
      id: item.id,
      title: item.title,
      notes: item.notes,
      pulled: item.pulled || false,
      pulled_date: item.pulled_date,
      stock: listings.stock,
      avgPrice: sales.avgPrice,
      lastSold: sales.lastSold,
      matchedTitles: listings.matchedTitles,
      confidence: listings.method === 'none' ? 'none' : (listings.method === 'model_phrase' || listings.method === 'part_number') ? 'high' : 'low',
      matchDebug: listings.debug,
      created_at: item.created_at
    });
  }

  // Sort: OUT OF STOCK (0, not pulled) > PULLED > LOW (1-2) > STOCKED (3+)
  results.sort((a, b) => {
    const rank = (item) => {
      if (item.stock === 0 && !item.pulled) return 0;
      if (item.pulled) return 1;
      if (item.stock <= 2) return 2;
      return 3;
    };
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.stock - b.stock;
  });

  res.json({ success: true, items: results, total: results.length });
});

// "Just Sold" — perch items that sold in the last 3 days
// Uses shared parseTitle for strict model+part matching (no loose keyword overlap)
router.get('/just-sold', async (req, res) => {
  const wantList = await database('restock_want_list').where({ active: true });
  const recentSales = await database('YourSale')
    .where('soldDate', '>=', database.raw("NOW() - INTERVAL '3 days'"))
    .whereNotNull('title')
    .select('title', 'salePrice', 'soldDate')
    .orderBy('soldDate', 'desc');

  // Pre-parse each want list item
  const parsedWantList = wantList.map(item => ({
    title: item.title,
    parsed: parseTitle(item.title)
  })).filter(w => w.parsed);

  // Group sales by want list item — strict matching: model + part phrase/words
  const grouped = new Map();
  for (const sale of recentSales) {
    const saleLower = (sale.title || '').toLowerCase();

    for (const want of parsedWantList) {
      const p = want.parsed;

      // Must match at least one model (or make if no model)
      let vehicleMatch = false;
      if (p.models.length > 0) {
        vehicleMatch = p.models.some(m => saleLower.includes(m.toLowerCase()));
      } else if (p.make) {
        vehicleMatch = saleLower.includes(p.make.toLowerCase());
      }
      if (!vehicleMatch) continue;

      // Must match part phrase or at least 2 part words
      let partMatch = false;
      if (p.partPhrase) {
        partMatch = saleLower.includes(p.partPhrase);
      } else if (p.partWords.length >= 2) {
        const wordHits = p.partWords.filter(w => saleLower.includes(w));
        partMatch = wordHits.length >= 2;
      }
      if (!partMatch) continue;

      // Also check part numbers if available
      let pnMatch = false;
      if (p.partNumbers.length > 0) {
        pnMatch = p.partNumbers.some(pn => saleLower.includes(pn.raw.toLowerCase()) || saleLower.includes(pn.base.toLowerCase()));
      }

      const daysAgo = Math.floor((Date.now() - new Date(sale.soldDate).getTime()) / 86400000);
      if (!grouped.has(want.title)) {
        grouped.set(want.title, { wantTitle: want.title, sales: [], matchedSaleTitles: [] });
      }
      const g = grouped.get(want.title);
      g.sales.push({
        price: Math.round(parseFloat(sale.salePrice) || 0),
        soldAgo: daysAgo <= 0 ? 'today' : daysAgo + 'd ago',
      });
      if (g.matchedSaleTitles.length < 5) g.matchedSaleTitles.push(sale.title);
      break; // one want match per sale
    }
  }

  // Fetch yard matches once per grouped item
  const results = [];
  for (const [, group] of grouped) {
    const yardVehicles = await matchPartToYardVehicles(group.wantTitle);
    results.push({
      wantTitle: group.wantTitle,
      sales: group.sales,
      matchedSaleTitles: group.matchedSaleTitles,
      yardMatches: yardVehicles.slice(0, 5).map(v => ({
        desc: [v.year, v.make, v.model].filter(Boolean).join(' '),
        yard: v.yard, row: v.row
      }))
    });
  }

  res.json({ success: true, items: results });
});

// Toggle pulled status
router.post('/pull', async (req, res) => {
  const { id, pulled } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required' });

  await database('restock_want_list').where({ id }).update({
    pulled: !!pulled,
    pulled_date: pulled ? new Date().toISOString() : null
  });
  res.json({ success: true });
});

// Find matching vehicles in yards
router.post('/find-in-yard', async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const vehicles = await matchPartToYardVehicles(title);
  res.json({ success: true, vehicles });
});

// Add a new part
router.post('/add', async (req, res) => {
  const { title, notes } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title required' });

  const [item] = await database('restock_want_list')
    .insert({ title: title.trim(), notes: notes || null, active: true })
    .returning('*');

  res.json({ success: true, item });
});

// Delete (soft) a part
router.post('/delete', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required' });

  await database('restock_want_list').where({ id }).update({ active: false });
  res.json({ success: true });
});

module.exports = router;
