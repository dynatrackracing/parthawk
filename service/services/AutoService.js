'use strict';

const { log } = require('../lib/logger');
const Joi = require('@hapi/joi');
const _ = require('lodash');
const { selectSchema } = require('../lib/schemas/taxonomySchema');
const TaxonomyAPI = require('../ebay/TaxonomyAPI');
const { makes } = require('../lib/constants');
const Promise = require('bluebird');
const { transaction } = require('objection');
const { Model } = require('objection/lib/model/Model');
const Auto = require('../models/Auto');
const { autoCreateSchema } = require('../lib/schemas/autoSchema');
const { v4: uuidv4 } = require('uuid');
const CacheManager = require('../middleware/CacheManager');
const EbayQueryCacheManager = require('../middleware/EbayQueryCacheManager')

class AutoService {
  constructor() {
    this.log = log.child({ class: 'AutoService' }, true);
    this.taxonomyAPI = new TaxonomyAPI();
    this.cacheManager = new CacheManager();
    // data here almost never changes. Can aggressively cache it for a month
    this.ebayQueryCacheManager = new EbayQueryCacheManager();
  }

  getDistinctKey({ year, make, model, trim, engine, ungroup }) {
    return `item_getDistinctList_${year}_${make}_${model}_${trim}_${engine}_${ungroup}`;
  }

  getLookupKey({ select, year, make, model, trim }) {
    return `auto_getCompatibilityTaxonomy_${select}_${year}_${make}_${model}_${trim}`;
  }

  async getDistinctList({ constraints }) {
    // destructure any possible params for scoping the distinct query
    const { year, make, model, trim, engine, ungroup } = constraints;

    const key = this.getDistinctKey(constraints);

    return this.cacheManager.get(key, async () => {
      // Query Auto table for all vehicles (not just those with linked Items)
      const statement = Auto.query()
        .distinct('id', 'year', 'make', 'model', 'trim', 'engine');

      const ItemLookupService = require('./ItemLookupService');
      const itemLookupService = new ItemLookupService();

      itemLookupService.scopeAutoStatement(statement, { year, make, model, trim, engine });

      let response = await statement;

      if (!ungroup) {
        response = this.processForUnique(response);
      }

      // Also pull year/make/model from YourSale titles to fill gaps
      try {
        const { database } = require('../database/database');
        const extraModels = await this.extractFromSales(database, { year, make, model });
        if (extraModels && !ungroup) {
          for (const y of extraModels.year) response.year.includes(y) || response.year.push(y);
          for (const m of extraModels.make) response.make.includes(m) || response.make.push(m);
          for (const m of extraModels.model) response.model.includes(m) || response.model.push(m);
          response.year.sort();
          response.make.sort();
          response.model.sort();
        }
      } catch (e) { /* ignore — YourSale enrichment is best-effort */ }

      return response;
    });
  }

  /**
   * Extract distinct year/make/model from YourSale titles to supplement Auto table.
   * This catches vehicles we've sold parts for but haven't catalogued in Auto yet.
   */
  async extractFromSales(database, filters) {
    const MAKE_LIST = ['Acura','Audi','BMW','Buick','Cadillac','Chevrolet','Chrysler','Dodge','Fiat','Ford','Genesis','GMC','Honda','Hummer','Hyundai','Infiniti','Isuzu','Jaguar','Jeep','Kia','Land Rover','Lexus','Lincoln','Mazda','Mercedes-Benz','Mini','Mitsubishi','Nissan','Oldsmobile','Pontiac','Porsche','Ram','Saab','Saturn','Scion','Subaru','Suzuki','Toyota','Volkswagen','Volvo'];
    const result = { year: [], make: [], model: [] };

    let query = database('YourSale').whereNotNull('title');
    // Only recent sales (last 365 days)
    query = query.where('soldDate', '>=', new Date(Date.now() - 365 * 86400000));

    if (filters.year) query = query.whereRaw('"title" ~ ?', [`\\m${filters.year}\\M`]);
    if (filters.make) query = query.whereRaw('"title" ILIKE ?', [`%${filters.make}%`]);
    if (filters.model) query = query.whereRaw('"title" ILIKE ?', [`%${filters.model}%`]);

    const sales = await query.select('title').limit(5000);

    const years = new Set(), makes = new Set(), models = new Set();
    for (const sale of sales) {
      const t = sale.title || '';
      // Extract year
      const ym = t.match(/\b((?:19|20)\d{2})\b/);
      if (ym) { const y = parseInt(ym[1]); if (y >= 1990 && y <= 2030) years.add(y); }
      // Extract make
      const tu = t.toUpperCase();
      for (const mk of MAKE_LIST) {
        if (tu.includes(mk.toUpperCase())) {
          makes.add(mk);
          // Extract model (word after make)
          const idx = tu.indexOf(mk.toUpperCase());
          const after = t.substring(idx + mk.length).trim().split(/\s+/);
          const mw = [];
          for (const w of after) {
            if (/^\d{4}/.test(w) || /^\d+\.\d+[lL]/.test(w)) break;
            if (/^(ECU|ECM|PCM|BCM|TCM|ABS|TIPM|OEM|Engine|Body|Control|Module)$/i.test(w)) break;
            mw.push(w);
            if (mw.length >= 2) break;
          }
          if (mw.length > 0) {
            const model = mw.join(' ').replace(/[^A-Za-z0-9 \-]/g, '').trim();
            if (model.length >= 2) models.add(model);
          }
          break;
        }
      }
    }

    result.year = [...years].sort();
    result.make = [...makes].sort();
    result.model = [...models].sort();
    return result;
  }

  processForUnique(arr) {
    const response = {
      year: new Set(),
      make: new Set(),
      model: new Set(),
      trim: new Set(),
      engine: new Set(),
    };

    arr.forEach(i => {
      response.year.add(i.year);
      response.make.add(i.make);
      response.model.add(i.model);
      response.trim.add(i.trim);
      response.engine.add(i.engine);
    });

    return {
      year: Array.from(response.year).sort(),
      make: Array.from(response.make).sort(),
      model: Array.from(response.model).sort(),
      trim: Array.from(response.trim).sort(),
      engine: Array.from(response.engine).sort(),
    };
  }

  async getCompatibilityTaxonomy({ constraints }) {
    const key = this.getLookupKey(constraints);
    return this.ebayQueryCacheManager.get(key, async() => {
      const { select, year, make, model, trim } = constraints;
      Joi.attempt(select, selectSchema);
  
      // exit here as we have our own pre-determined list of makes we support
      if (select === 'Make') {
        return makes.map((make) => {
          return {
            value: make,
          }
        });
      }
  
      let filter = '';
  
      if (year) {
        filter = `${filter}Year:${year},`;
      }
      if (make) {
        filter = `${filter}Make:${make},`;
      }
      if (model) {
        filter = `${filter}Model:${model},`;
      }
      if (trim) {
        filter = `${filter}Trim:${trim}`;
      }
  
      const options = {
        select, filter,
      };
  
      const { compatibilityPropertyValues } = await this.taxonomyAPI.makeRequest(options);
  
      return compatibilityPropertyValues;
    });
  }

  async createAuto({ body }, { trx = Model.knex() } = {}) {
    Joi.attempt(body, autoCreateSchema);

    const { year, make, model, trim, engine } = body;
    return transaction(trx, async (tx) => {
      const response = await Auto.query(tx).insertAndFetch({
        year,
        make,
        model,
        trim,
        engine,
      });

      return response;
    });
  }

  async updateAuto({ id, body }) {
    const { year, make, model, trim, engine } = body;

    const toUpdate = {
      year, make, model, trim, engine
    };

    Joi.attempt(toUpdate, autoCreateSchema);

    const response = await Auto.query().patchAndFetchById(id, toUpdate);

    return response;
  }

  async getAutoById({ id }) {
    const response = await Auto.query().where('id', id);
    return response;
  }

  async getOrCreateAutos({ autos }, { trx = Auto.knex() } = {}) {
    const ret = [];

    await Promise.mapSeries(autos, async (auto) => {
      // the auto already has an id, look up from the database
      return transaction(trx, async (tx) => {
        let retAuto;
        if (auto.id) {
          retAuto = await Auto.query(tx).findById(auto.id);
          if (retAuto) {
            ret.push(retAuto);
          } else {
            this.log.info({ auto }, 'Got auto with id, but was not able to find it in the database');
          }
        } else {
          // we don't have the item, we need to look up the remaining info
          // then insert all the engines
          const { make, model, year, trim } = auto;

          // check whether we have this auto already in the database
          const query = Auto.query(tx)
            .where('make', make)
            .where('model', model)
            .where('year', year)
            .where('trim', trim);

          const matches = await query;
          if (!_.isEmpty(matches)) {
            this.log.debug({ count: matches.length, auto }, 'Found some items in the database')
            ret.push(...matches);
            return;
          }

          // we didnt have a match in the database, so look up extra engine info and then commit to the database
          const engines = await this.getCompatibilityTaxonomy({
            constraints: {
              year,
              make,
              model,
              trim,
              select: 'Engine',
            }
          });

          await Promise.mapSeries(engines, async (engine) => {
            const createdAuto = await Auto.query(tx).insertAndFetch({
              id: uuidv4(),
              year,
              make,
              model,
              trim,
              engine: engine.value
            });

            ret.push(createdAuto);
          });
        }
      });
    });

    return ret;
  }
}

module.exports = AutoService;