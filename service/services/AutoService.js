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

    // Cache TTL: 5 minutes (was indefinite, stale after Auto table changes)
    return this.cacheManager.get(key, async () => {
      // Query Auto table only — clean curated year/make/model data
      const statement = Auto.query()
        .distinct('id', 'year', 'make', 'model', 'trim', 'engine');

      const ItemLookupService = require('./ItemLookupService');
      const itemLookupService = new ItemLookupService();

      itemLookupService.scopeAutoStatement(statement, { year, make, model, trim, engine });

      let response = await statement;

      if (!ungroup) {
        response = this.processForUnique(response);
      }

      return response;
    });
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