'use strict';

const { log } = require('./logger');
const { database } = require('../database/database');
const SoldItemsManager = require('../managers/SoldItemsManager');

/**
 * CompetitorDripRunner — Randomized micro-scrape runner.
 *
 * Called 4x daily (6am, noon, 6pm, midnight UTC) from index.js crons.
 * Each run: random 0-45min startup delay, picks the least-recently-scraped
 * enabled seller, scrapes 1-2 random pages, cleans up the browser.
 *
 * Replaces the old Sunday 8pm "blast all sellers at once" cron that risked
 * eBay rate-limiting and Playwright OOM on Railway.
 */
class CompetitorDripRunner {
  constructor() {
    this.log = log.child({ class: 'CompetitorDripRunner' }, true);
  }

  async runDrip() {
    // Random delay 0-45 minutes so execution time varies daily
    const delayMs = Math.floor(Math.random() * 45 * 60 * 1000);
    const delayMin = Math.round(delayMs / 60000);
    this.log.info({ delayMinutes: delayMin }, 'Drip scrape scheduled, waiting random delay');

    await new Promise(resolve => setTimeout(resolve, delayMs));

    // Pick the seller least recently scraped
    const seller = await database('SoldItemSeller')
      .where('enabled', true)
      .orderByRaw('"lastScrapedAt" ASC NULLS FIRST')
      .first();

    if (!seller) {
      this.log.info('No enabled sellers found, skipping drip');
      return { skipped: true, reason: 'no enabled sellers' };
    }

    // Skip if this seller was scraped within the last 6 hours
    if (seller.lastScrapedAt && (Date.now() - new Date(seller.lastScrapedAt).getTime()) < 6 * 60 * 60 * 1000) {
      this.log.info({ seller: seller.name, lastScraped: seller.lastScrapedAt }, 'All sellers recently scraped, skipping');
      return { skipped: true, reason: 'all sellers fresh', seller: seller.name };
    }

    const maxPages = 1 + Math.floor(Math.random() * 2); // 1 or 2 pages
    this.log.info({ seller: seller.name, maxPages, delayMinutes: delayMin }, 'Starting drip scrape');

    const manager = new SoldItemsManager();
    try {
      const result = await manager.scrapeCompetitor({
        seller: seller.name,
        categoryId: '6030',
        maxPages,
      });

      // Update seller stats
      await database('SoldItemSeller').where('name', seller.name).update({
        lastScrapedAt: new Date(),
        itemsScraped: (seller.itemsScraped || 0) + (result.stored || 0),
        updatedAt: new Date(),
      });

      this.log.info({ seller: seller.name, maxPages, stored: result.stored, scraped: result.scraped }, 'Drip scrape complete');
      return { seller: seller.name, maxPages, ...result };
    } catch (err) {
      this.log.error({ err: err.message, seller: seller.name }, 'Drip scrape failed');
      return { seller: seller.name, error: err.message };
    } finally {
      try { await manager.scraper.closeBrowser(); } catch (e) {}
    }
  }
}

module.exports = new CompetitorDripRunner();
