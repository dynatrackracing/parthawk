'use strict';
const { log } = require('../lib/logger');
const NodeCache = require('node-cache');
const _ = require('lodash');
class CacheManager {
  constructor() {
    // this is a singleton because we create a new service on every http req
    if (!CacheManager.instance) {
      this.log = log.child({ class: 'CacheManager' }, true);
      this.cache = new NodeCache({
        stdTTL: 60 * 1000,
        checkperiod: 60 * 1000 * 0.2,
        useClones: false,
      });
      CacheManager.instance = this;
    }
    return CacheManager.instance;
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

  // given an array of strings, delete all keys containing those strings
  delContains(constraints) {
    if (_.isEmpty(constraints)) {
      return;
    }
    const keys = this.cache.keys().filter((string) => {
      return string.includes('getDistinctList') || string.includes('getItemsForAuto');
    });

    for (const key of keys) {
      const [type, fn, year, make, model, trim, engine] = key.split('_');
      if (!_.isEmpty(_.intersection([year, make, model, trim, engine], constraints))) {
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


module.exports = CacheManager;