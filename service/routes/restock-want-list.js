'use strict';

const router = require('express-promise-router')();
const { database } = require('../database/database');

// Get all active want list items with stock counts and sale data
router.get('/items', async (req, res) => {
  const knex = database;
  const items = await knex('restock_want_list').where({ active: true }).orderBy('created_at', 'asc');

  // Build stock + sales data for each item
  const results = [];
  for (const item of items) {
    const keywords = extractKeywords(item.title);
    let stock = 0;
    let avgPrice = null;
    let lastSold = null;

    if (keywords.length >= 2) {
      // Count active listings matching keywords
      let listingQuery = knex('YourListing').where('listingStatus', 'Active');
      for (const kw of keywords) {
        listingQuery = listingQuery.andWhere('title', 'ilike', `%${kw}%`);
      }
      const [{ count }] = await listingQuery.count('* as count');
      stock = parseInt(count) || 0;

      // Get avg price and last sold from YourSale
      let saleQuery = knex('YourSale');
      for (const kw of keywords) {
        saleQuery = saleQuery.andWhere('title', 'ilike', `%${kw}%`);
      }
      const sales = await saleQuery.select(
        knex.raw('AVG("salePrice") as avg_price'),
        knex.raw('MAX("soldDate") as last_sold'),
        knex.raw('COUNT(*) as sold_count')
      ).first();

      if (sales && parseInt(sales.sold_count) > 0) {
        avgPrice = Math.round(parseFloat(sales.avg_price) || 0);
        lastSold = sales.last_sold;
      }
    }

    results.push({
      id: item.id,
      title: item.title,
      notes: item.notes,
      stock,
      avgPrice,
      lastSold,
      created_at: item.created_at
    });
  }

  // Sort: 0 stock first, then ascending
  results.sort((a, b) => a.stock - b.stock);

  res.json({ success: true, items: results, total: results.length });
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

// Extract 2-4 meaningful keywords from a part title for matching
function extractKeywords(title) {
  const stop = new Set([
    'oem','the','and','for','with','only','new','used','genuine','assembly',
    'complete','module','unit','w','w/','a','an','in','on','of','to','or',
    '4x4','2wd','4wd','awd','fwd','rwd','v6','v8','2.3l','2.7l','3.5l',
    '3.8l','4.7l','5.7l','2.0l','combo','set','left','right','upper','lower',
    'rear','front','driver','passenger','automatic','manual','electric','oem',
    'non-turbo','turbo','plastic','dark','gray','black','blue','yellow',
    'discount','prices','check','get','plugs','good','shape'
  ]);
  // Remove parenthetical notes, OEM part numbers, year ranges
  const cleaned = title
    .replace(/\([^)]*\)/g, '')
    .replace(/\b[A-Z0-9]{5,}-[A-Z0-9]+\b/g, '')
    .replace(/\b\d{5,}\b/g, '')
    .replace(/\b(19|20)?\d{2}[-–]\s*(19|20)?\d{2,4}\b/g, '')
    .replace(/\b(19|20)\d{2}\b/g, '')
    .replace(/\b\d{2}\b/g, '')
    .replace(/[^a-zA-Z\s]/g, ' ');

  const words = cleaned.split(/\s+/)
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length >= 2 && !stop.has(w));

  // Dedupe and take top 3 most meaningful
  const unique = [...new Set(words)];
  return unique.slice(0, 3);
}

module.exports = router;
