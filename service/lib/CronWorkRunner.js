'use strict';
const { log } = require('./logger');
const SellerItemManager = require('../managers/SellerItemManager');
const Item = require('../models/Item');
const ItemDetailsManager = require('../managers/ItemDetailsManager');
const AsyncLock = require('async-lock');
const { v4: uuidv4 } = require('uuid');
const Cron = require('../models/Cron');
const CacheManager = require('../middleware/CacheManager');
const CompetitorManager = require('../managers/CompetitorManager');

const lock = new AsyncLock({ maxPending: 0, timeout: 1000 });
class CronWorkRunner {
  constructor() {
    this.log = log.child({ class: 'CronWorkRunner' }, true);
    this.lock = lock;
    this.cacheManager = new CacheManager();
  }

  async work() {
    const key = 'cronRunGather';

    if (this.lock.isBusy(key)) {
      this.log.debug('Cron gather is still running!');
      return;
    }

    try {
      await this.lock.acquire(key, async() => {
        this.log.info('lock acquired, starting cron work')
        await this.doWork();
      })
    } catch (err) {
      // DO NOT LET ERRORS ESCAPE, just log them
      if (err.message === 'async-lock timed out' || err.message === 'Too much pending tasks') {
        // this error shouldn't occur because of the isBusy check above
        this.log.warn(err, `Unable to acquire lock key ${key}, primary gather is already running`);
      } else {
        this.log.error({ err, message: err.message, stack: err.stack }, 'Unexpected error occurred during primary gather: ' + err.message);
      }
    }   
  }

  async doPreWork() {
    // clean up database
  }

  async doPostWork() {
    this.log.debug('Flushing all item based caches');
    this.cacheManager.delStartWith('item');
  }

  async doWork() {
    this.log.info('Running pre cron work taks');
    await this.doPreWork();

    const itemCount = await Item.query().count();
    this.log.info({ count: itemCount[0]['count'] }, `Currently found ${itemCount[0]['count']} items in our database`);

    // get the count of items that are unprocessed
    let skipNewItems = false;
    const items = await Item.query().where('processed', false);
    this.log.info({ count: items.length }, 'Found unprocessed items');
    if (items.length > 0) {
      this.log.info('Found unprocessed items, skipping import of new items and running processing instead');
      skipNewItems = true;
    }

    // if there are any unprocessed items, we want to skip pulling anything new from eBay
    if (!skipNewItems) {
      const sellerManager = new SellerItemManager();

      const competitorManager = new CompetitorManager();
      const sellers = await competitorManager.getAllCompetitors();

      await sellerManager.getItemsForSellers(sellers);

      const newItemCount = await Item.query().count();
      this.log.info({ newItemCount: newItemCount[0]['count'] }, `Currently found ${newItemCount[0]['count']} items in our database. ${newItemCount[0]['count'] - itemCount[0]['count']} new items added`);
    }

    const itemsManager = new ItemDetailsManager();
    const { total, processed, unprocessed, time, duplicateCount, apiCalls } =  await itemsManager.processItems();

    this.log.info({
      total, processed, unprocessed, time, duplicateCount, apiCalls
    }, '!! Metrics on latest cron route');

    // log info to database
    await Cron.query().insert({
      id: uuidv4(),
      total,
      processed,
      unprocessed,
      elapsed: time,
      duplicate: duplicateCount,
      apiCalls,
    });

    this.log.info('All items processed');

    this.log.info('Running post work');
    await this.doPostWork();
  }
}

module.exports = CronWorkRunner;