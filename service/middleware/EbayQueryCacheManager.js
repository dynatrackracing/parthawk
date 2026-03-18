'use strict';
const { log } = require('../lib/logger');
const NodeCache = require('node-cache');
class EbayQueryCacheManager {
  constructor() {
    // this is a singleton because we create a new service on every http req
    if(!EbayQueryCacheManager.instance) {
      this.log = log.child({ class: 'EbayQueryCacheManager' }, true);
      this.cache = new NodeCache({
        stdTTL: 60 * 1000 * 1440 * 30, // 1 month
        checkperiod: 60 * 1000 * 0.2,
        useClones: false,
      });
      EbayQueryCacheManager.instance = this;
    }
    return EbayQueryCacheManager.instance;
  }

  get(key, storeFunction) {
    const value = this.cache.get(key);
    if (value) {
      return Promise.resolve(value);
    }

    return storeFunction().then((result) => {
      this.cache.set(key, result);
      return result;
    });
  }

  del(keys) {
    this.cache.del(keys);
  }

  delStartWith(startStr = '') {
    if (!startStr) {
      return;
    }

    const keys = this.cache.keys();
    for (const key of keys) {
      if (key.indexOf(startStr) === 0) {
        this.del(key);
      }
    }
  }

  flush() {
    this.cache.flushAll();
  }

  stats() {
    return this.cache.getStats();
  }
}


module.exports = EbayQueryCacheManager;