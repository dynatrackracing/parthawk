'use strict';

const { log } = require('./logger');
const { database } = require('../database/database');
const SoldItemsManager = require('../managers/SoldItemsManager');

/**
 * CompetitorDripRunner — Randomized micro-scrape runner.
 *
 * Called 6x daily (every 4h) from index.js crons.
 * Each run: random 0-45min startup delay, picks the 2 least-recently-scraped
 * enabled sellers, scrapes 1-2 random pages each, cleans up the browser.
 *
 * 6 runs × 2 sellers = 12 seller scrapes/day → full 12-seller rotation in ~24h.
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

    // Pick the 2 sellers least recently scraped
    const sellers = await database('SoldItemSeller')
      .where('enabled', true)
      .orderByRaw('"lastScrapedAt" ASC NULLS FIRST')
      .limit(2);

    if (!sellers || sellers.length === 0) {
      this.log.info('No enabled sellers found, skipping drip');
      return { skipped: true, reason: 'no enabled sellers' };
    }

    // Skip if the stalest seller was scraped within the last 3 hours
    // (with 6 runs/day, 3h cooldown prevents re-scraping the same seller twice in a row)
    const stalest = sellers[0];
    if (stalest.lastScrapedAt && (Date.now() - new Date(stalest.lastScrapedAt).getTime()) < 3 * 60 * 60 * 1000) {
      this.log.info({ seller: stalest.name, lastScraped: stalest.lastScrapedAt }, 'All sellers recently scraped, skipping');
      return { skipped: true, reason: 'all sellers fresh', seller: stalest.name };
    }

    const results = [];

    for (let i = 0; i < sellers.length; i++) {
      const seller = sellers[i];
      const maxPages = 1 + Math.floor(Math.random() * 2); // 1 or 2 pages
      this.log.info({ seller: seller.name, maxPages, sellerIndex: i + 1, sellerCount: sellers.length }, 'Starting drip scrape');

      const manager = new SoldItemsManager();
      try {
        const result = await manager.scrapeCompetitor({
          seller: seller.name,
          categoryId: '0',
          maxPages,
        });

        // Update seller stats — only advance lastScrapedAt on successful scrapes
        if ((result.stored || 0) > 0) {
          await database('SoldItemSeller').where('name', seller.name).update({
            lastScrapedAt: new Date(),
            itemsScraped: (seller.itemsScraped || 0) + result.stored,
            updatedAt: new Date(),
          });
        } else {
          this.log.warn({ seller: seller.name, scraped: result.scraped }, 'Scraper returned 0 stored items, lastScrapedAt NOT advanced');
        }

        this.log.info({ seller: seller.name, maxPages, stored: result.stored, scraped: result.scraped }, 'Drip scrape complete');
        results.push({ seller: seller.name, maxPages, ...result });
      } catch (err) {
        this.log.error({ err: err.message, seller: seller.name }, 'Drip scrape failed');
        results.push({ seller: seller.name, error: err.message });
      } finally {
        try { await manager.scraper.closeBrowser(); } catch (e) {}
      }

      // 30-60s delay between sellers (not after the last one)
      if (i < sellers.length - 1) {
        const interDelay = 30000 + Math.floor(Math.random() * 30000);
        this.log.info({ delaySeconds: Math.round(interDelay / 1000) }, 'Inter-seller delay');
        await new Promise(resolve => setTimeout(resolve, interDelay));
      }
    }

    return results;
  }
}

module.exports = new CompetitorDripRunner();
