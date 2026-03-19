'use strict';

/**
 * buildScrapeQueue.js — Populate fitment_scrape_queue from YourSale data.
 * Uses Knex (not raw pg Pool).
 *
 * Run locally:  DATABASE_URL=postgres://... node service/scripts/buildScrapeQueue.js
 * Run via API:  POST /api/build-scrape-queue
 */

const { database } = require('../database/database');
const { normalizePartNumber } = require('../lib/partNumberUtils');

async function buildQueue() {
  console.log('Building fitment scrape queue from sales data...');

  const sales = await database('YourSale').whereNotNull('title').select('title', 'salePrice', 'sku');
  const partMap = {};

  for (const sale of sales) {
    const title = sale.title || '';
    let pn = null;

    const chrysler = title.match(/\b(\d{8}[A-Z]{2})\b/);
    if (chrysler) pn = chrysler[1];
    if (!pn) { const toyota = title.match(/\b(\d{5}-[A-Z0-9]{3,7})\b/); if (toyota) pn = toyota[1]; }
    if (!pn) { const ford = title.match(/\b([A-Z]{1,4}\d{1,2}[A-Z]-[A-Z0-9]{4,6}-[A-Z]{2})\b/); if (ford) pn = ford[1]; }
    if (!pn) { const gm = title.match(/\b(\d{7,8})\b/); if (gm) pn = gm[1]; }
    if (!pn) continue;

    if (!partMap[pn]) partMap[pn] = { count: 0, totalPrice: 0, titles: [] };
    partMap[pn].count++;
    partMap[pn].totalPrice += parseFloat(sale.salePrice) || 0;
    if (partMap[pn].titles.length < 2) partMap[pn].titles.push(title);
  }

  console.log(`Found ${Object.keys(partMap).length} unique part numbers`);

  const highRisk = ['ECM', 'BCM', 'TCM', 'TIPM', 'ABS', 'CLUSTER'];
  let inserted = 0, updated = 0;

  for (const [pn, data] of Object.entries(partMap)) {
    const basePn = normalizePartNumber(pn);
    const avgPrice = data.count > 0 ? data.totalPrice / data.count : 0;
    const combined = data.titles.join(' ').toLowerCase();
    let category = 'OTHER';
    if (/\b(ecu|ecm|pcm|engine control)\b/.test(combined)) category = 'ECM';
    else if (/\b(bcm|body control)\b/.test(combined)) category = 'BCM';
    else if (/\b(tcm|tcu|transmission control)\b/.test(combined)) category = 'TCM';
    else if (/\b(tipm|fuse box|junction)\b/.test(combined)) category = 'TIPM';
    else if (/\b(abs|anti.?lock|brake pump)\b/.test(combined)) category = 'ABS';
    else if (/\b(cluster|speedometer|gauge)\b/.test(combined)) category = 'CLUSTER';
    else if (/\b(radio|stereo|amplifier)\b/.test(combined)) category = 'RADIO';

    const priority = Math.min(100, 10 + Math.min(50, data.count * 5) + (avgPrice >= 200 ? 10 : 0) + (highRisk.includes(category) ? 20 : 0));

    try {
      const existing = await database('fitment_scrape_queue').where('part_number', pn).first();
      if (existing) {
        await database('fitment_scrape_queue').where('part_number', pn).update({ priority: Math.max(existing.priority || 0, priority), sales_count: data.count, category });
        updated++;
      } else {
        await database('fitment_scrape_queue').insert({ part_number: pn, part_number_base: basePn, category, priority, sales_count: data.count, status: 'pending', created_at: new Date() });
        inserted++;
      }
    } catch (e) { /* duplicate */ }
  }

  const total = await database('fitment_scrape_queue').count('* as cnt').first();
  console.log(`Queue: ${inserted} added, ${updated} updated, ${total?.cnt} total`);
  return { inserted, updated, total: parseInt(total?.cnt || 0) };
}

if (require.main === module) {
  const { Model } = require('objection');
  Model.knex(database);
  database.migrate.latest(database.client.config.migration).then(() => buildQueue()).then(() => database.destroy()).catch(e => { console.error(e); database.destroy(); });
}

module.exports = { buildQueue };
