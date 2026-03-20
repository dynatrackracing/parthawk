'use strict';

const { log } = require('../lib/logger');
const { Model } = require('objection/lib/model/Model');
const Auto = require('../models/Auto');
const _ = require('lodash');
const Item = require('../models/Item');
const { itemCreateSchema } = require('../lib/schemas/itemSchema');
const Joi = require('@hapi/joi');
const { v4: uuidv4 } = require('uuid');
const AutoService = require('./AutoService');
const CacheManager = require('../middleware/CacheManager');
const { normalizePartNumber } = require('../lib/partNumberUtils');

const CUSTOM_EBAY_ID = 'custom';
const CUSTOM_CATEGORY_ID = '0';
const CUSTOM_CATEGORY_TITLE = 'custom';
const CUSTOM_SELLER = 'dynatrack';

class ItemLookupService {
  constructor(args) {
    this.log = log.child({ class: 'ItemLookupService' }, true);
    this.cacheManager = new CacheManager();
    this.user = args ? args.user : null;
  }

  getItemsForAutoKey({ year, make, model, trim, engine }) {
    return `item_getItemsForAuto_${year}_${make}_${model}_${trim}_${engine}`;
  }

  async getItemsForAuto({ year, make, model, trim, engine }, { trx = Model.knex() } = {}) {
    const key = this.getItemsForAutoKey({ year, make, model, trim, engine });

    return this.cacheManager.get(key, async () => {

      let statement = Auto.query().select('year', 'make', 'model', 'trim', 'engine')
        .withGraphFetched('itemCompatibilities(selectPrice)')
        .modifiers({
          selectPrice(builder) {
            builder.where('price', '>', '80');
          }
        });
        

      this.scopeAutoStatement(statement, { year, make, model, trim, engine });

      const response = await statement;

      const setArr = [];
      response.forEach((res) => {
        setArr.push(...res.itemCompatibilities);
      });
      let unique = _.uniqBy(setArr, 'id');

      if(!this.user.canSeePrice){
        unique = unique.map(item => _.omit(item, 'price'));
      }

      return {
        count: unique.size,
        response: unique,
      }
    });
  }

  async getAutosForItem({ partNumber }) {
    let statement = Item.query().select().where('manufacturerPartNumber', partNumber).withGraphFetched('autoCompatibilities');

    const response = await statement;

    return { count: response[0].autoCompatibilities.length, response };
  }

  async getLatestItems({ count }) {
    let statement = Item.query().select().orderBy('createdAt').limit(count);

    const response = await statement;

    return response;
  }

  async getItemById({ id }) {
    const columns = ['id', 'pictureUrl', 'title', 'manufacturerPartNumber', 'categoryTitle', 'price', 'isRepair', 'salesEase', 'difficulty', 'notes', 'createdAt'];
    if(this.user.canSeePrice) columns.push('price');

    const statement = Item.query().select(...columns).where('id', id).withGraphFetched('autoCompatibilities');

    let response = await statement;

    return response;
  }

  scopeAutoStatement(statement, { year, make, model, trim, engine }) {
    if (year) {
      const y = parseInt(year);
      if (!isNaN(y)) {
        statement.whereRaw('"year"::int >= ? AND "year"::int <= ?', [y - 1, y + 1]);
      } else {
        statement.where('year', year);
      }
    }
    if (make) {
      statement.where('make', make);
    }
    if (model) {
      statement.where('model', 'like', `%${model}%`);
    }
    if (trim) {
      statement.where('trim', 'like', `%${trim}%`);
    }
    if (engine) {
      statement.where('engine', 'like', `%${engine}%`);
    }
  }

  async update({ body }) {
    this.log.debug({ body }, 'Updating item');

    const { auto } = body;

    const autoService = new AutoService();

    const autoCompatibilities = await autoService.getOrCreateAutos({ autos: auto });

    body.autoCompatibilities = autoCompatibilities;
    if (body.manufacturerPartNumber) {
      body.partNumberBase = normalizePartNumber(body.manufacturerPartNumber);
    }

    delete body.auto;

    const response = await Item.query().upsertGraphAndFetch(body, {
      relate: true
    });

    this.log.debug({ id: response.id }, 'Item successfully updated');

    this.log.debug({ id: response.id }, 'Clearing cache now that item has been updated');
    this.cacheManager.del(autoService.getDistinctKey({}));
    this.clearCachePostUpdate(auto);

    return response;
  }

  clearCachePostUpdate(auto) {
    this.log.debug('Creating list of cache keys to clear based on item update');
    let cacheClearer = new Set();
    auto.forEach((auto) => {
      cacheClearer.add(auto.year).add(auto.make).add(auto.model);
    });

    this.cacheManager.delContains(Array.from(cacheClearer));
  }

  async createItem({ body }) {
    this.log.debug({ body }, 'Creating new item');

    // get the auto items
    const { auto } = body;

    const autoService = new AutoService();

    const autoCompatibilities = await autoService.getOrCreateAutos({ autos: auto });

    // create new item
    const newItem = {
      id: uuidv4(),
      ebayId: `${CUSTOM_EBAY_ID}-${uuidv4()}`,
      price: body.price,
      title: body.title,
      categoryId: CUSTOM_CATEGORY_ID,
      categoryTitle: body.categoryTitle || CUSTOM_CATEGORY_TITLE,
      seller: CUSTOM_SELLER,
      processed: true,
      difficulty: body.difficulty,
      salesEase: body.salesEase,
      notes: body.notes,
      pictureUrl: body.pictureUrl,
      manufacturerPartNumber: body.manufacturerPartNumber,
      partNumberBase: normalizePartNumber(body.manufacturerPartNumber),
      autoCompatibilities,
    };

    delete body.auto;

    Joi.attempt(body, itemCreateSchema.required());

    const response = await Item.query().insertGraphAndFetch(newItem, {
      relate: true
    });

    this.log.debug({ response }, 'item successfully created');

    this.log.debug({ id: response.id }, 'Clearing cache now that item has been created');
    this.cacheManager.del(autoService.getDistinctKey({}));
    this.clearCachePostUpdate(auto);

    return response;
  }

  async searchItems({ constraints }) {
    this.log.debug(constraints, 'searching for items');

    const { title, seller, categoryTitle, manufacturerPartNumber } = constraints;

    const columns = ['id', 'pictureUrl', 'title', 'manufacturerPartNumber', 'categoryTitle'];
    if(this.user.canSeePrice) columns.push('price');

    const statement = Item.query().select(...columns);

    if (title) {
      statement.whereRaw('title ILIKE ?', [`%${title}%`]);
    }
    if (seller) {
      statement.whereRaw('seller ILIKE ?', [`%${seller}%`]);
    }
    if (categoryTitle) {
      statement.whereRaw('"Item"."categoryTitle" ILIKE ?', [`%${categoryTitle}%`]);
    }
    if (manufacturerPartNumber) {
      statement.whereRaw('"Item"."manufacturerPartNumber" ILIKE ?', [`%${manufacturerPartNumber}%`]);
    }

    const response = await statement;

    return response;
  }

  async deleteItemById({ id }) {
    this.log.debug({ id }, 'deleting item by id');

    const response = await Item.query().where('id', id).del();

    return response;
  }

  async getFilter({ field }) {
    const response = await Item.query().distinct(field).orderBy(field, 'ASC');

    return response.map(i => i[field]);
  }
}

module.exports = ItemLookupService;