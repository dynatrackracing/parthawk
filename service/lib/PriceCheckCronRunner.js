'use strict';

const { log } = require('./logger');
const PriceCheckService = require('../services/PriceCheckService');
const PriceCheck = require('../models/PriceCheck');
const YourListing = require('../models/YourListing');
const AsyncLock = require('async-lock');
const { v4: uuidv4 } = require('uuid');

const lock = new AsyncLock({ maxPending: 0, timeout: 1000 });

class PriceCheckCronRunner {
  constructor() {
    this.log = log.child({ class: 'PriceCheckCronRunner' }, true);
    this.lock = lock;
  }

  async work({ batchSize = 15 } = {}) {
    const key = 'priceCheckCron';

    if (this.lock.isBusy(key)) {
      this.log.debug('Price check cron is still running!');
      return;
    }

    try {
      await this.lock.acquire(key, async () => {
        this.log.info({ batchSize }, 'Lock acquired, starting price check cron');
        await this.doWork(batchSize);
      });
    } catch (err) {
      if (err.message === 'async-lock timed out' || err.message === 'Too much pending tasks') {
        this.log.warn(err, `Unable to acquire lock key ${key}, price check cron is already running`);
      } else {
        this.log.error(err, 'Unexpected error occurred during price check cron');
      }
    }
  }

  async doWork(batchSize) {
    const startTime = Date.now();

    // Get listings that need price checks
    const listings = await this.getListingsNeedingPriceCheck(batchSize);

    if (listings.length === 0) {
      this.log.info('No listings need price checks');
      return;
    }

    this.log.info({ count: listings.length }, 'Found listings needing price check');

    let processed = 0;
    let errors = 0;

    for (const listing of listings) {
      try {
        this.log.debug({
          listingId: listing.id,
          title: listing.title?.substring(0, 50)
        }, 'Checking price');

        await PriceCheckService.checkPrice(
          listing.id,
          listing.title,
          parseFloat(listing.currentPrice),
          true // force refresh
        );

        processed++;

        // Random delay between checks (3-6 seconds) to avoid rate limiting
        const delay = 3000 + Math.random() * 3000;
        await this.sleep(delay);

      } catch (err) {
        errors++;
        this.log.error({
          err,
          listingId: listing.id
        }, 'Error checking price for listing');

        // Longer delay after error
        await this.sleep(5000);
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    this.log.info({
      processed,
      errors,
      elapsed,
      batchSize,
    }, 'Price check cron completed');
  }

  /**
   * Get listings that need price checks, prioritized by:
   * 1. Never checked (no PriceCheck record)
   * 2. Most stale (oldest checkedAt)
   *
   * Omitted listings are always excluded.
   * Cache window is 7 days — cron runs weekly so each listing gets checked once per week.
   */
  async getListingsNeedingPriceCheck(limit) {
    const cacheMaxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    const cutoff = new Date(Date.now() - cacheMaxAge);

    // Get IDs of listings with a price check within the last 7 days
    const recentChecks = await PriceCheck.query()
      .select('listingId')
      .where('checkedAt', '>', cutoff)
      .groupBy('listingId');

    const recentlyCheckedIds = recentChecks.map(r => r.listingId);

    // Get active, non-omitted, in-stock listings that haven't been checked in the last 7 days
    let query = YourListing.query()
      .where('listingStatus', 'Active')
      .where('priceCheckOmitted', false)
      .where('quantityAvailable', '>', 0)
      .orderBy('startTime', 'asc') // Older listings first
      .limit(limit);

    if (recentlyCheckedIds.length > 0) {
      query = query.whereNotIn('id', recentlyCheckedIds);
    }

    return query;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = PriceCheckCronRunner;
