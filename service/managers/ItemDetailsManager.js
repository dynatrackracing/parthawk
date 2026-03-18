'use strict';
const { log } = require('../lib/logger');
const Auto = require('../models/Auto');
const Item = require('../models/Item');
const { v4: uuidv4 } = require('uuid');
const TradingAPI = require('../ebay/TradingAPI');
const Promise = require('bluebird');
const _ = require('lodash');
class ItemDetailsManager {
  constructor() {
    this.log = log.child({ class: 'ItemDetailsManager' }, true);
    this.tradingAPI = new TradingAPI();
  }


  async getDetailsForItem({ itemId }) {
    const response = await this.tradingAPI.makeRequest({
      ebayItemId: itemId,
      options: {
        includeItemCompatibility: true,
        includeItemSpecifics: true,
      }
    });

    // check for edge case here
    if (!response) {
      this.log.info('No response from eBay API');
      return null;
    }
    if (response.GetItemResponse.Ack[0] === 'Failure') {
      this.log.info({ response: response.GetItemResponse }, 'unable to get item');
      this.log.info({ error: response.GetItemResponse.Errors?.[0]?.LongMessage?.[0] }, 'possible error');
      return null;
    }

    // return just the item, skip all the fluff
    return response.GetItemResponse.Item[0];
  }

  getInterchangeNumbers(string) {
    let arr = [];
    // try to split on ,
    if (string.includes(',')) {
      arr = string.split(',').map(i => i.trim());
      return arr;
    }

    // some chrysler parts are split on space
    if (string.includes(' ')) {
      arr = string.split(' ').map(i => i.trim());
      return arr;
    }

    // else just return the string
    arr.push(string);
    return arr;
  }

  getManufacturerPartNumber(string) {
    if (string.includes(',')) {
      return string.split(',')[0].trim();
    }

    return string;
  }

  async checkForDuplicate(item) {
    // Is this importapart. Separate sellers will likely have different heuristics
    if (item.seller != 'importapart') {
      return false;
    }

    const categories = ['Engine Computers', 'ECUs & Computer Modules'];
    // Is this item an Engine Computer? If not, exit, we don't have enough info to determine if its a duplicate
    if (!categories.includes(item.categoryTitle)) {
      return false;
    }

    // does this item contain the phrase for ECU? If not, we can't be sure we're parsing it right
    const { title } = item;
    const ecuString = 'ECU ECM PCM Engine Computer';
    const ecuString2 = 'ECU ECM PCM Engine Control Computer';
    const includesString1 = title.includes(ecuString);
    const includesString2 = title.includes(ecuString2)
    if (!includesString1 && !includesString2) {
      return false;
    }

    // now split the title on the string and perform the analysis
    let first, second;
    if (includesString1) {
      [first, second] = title.split(ecuString);
    }
    if (includesString2) {
      [first, second] = title.split(ecuString2);
    }

    // trim strings
    first = first.trim(); // contains year, make, model
    second = second.trim(); // contains manufacturerPartNumber and other proprietary info

    // split on space to go through each 
    const info = second.split(' ');

    const progIndex = _.indexOf(info, 'PROG');

    if (progIndex != '-1') {
      // remove PROG from array
      info.splice(progIndex);
    }

    // TODO: match regex based on model
    // match car info make/model to potential regex mapping
    // Ford
    // Chrysler, Dodge, Ram, etc

    // match regex to info[] to find our best guess at the partNumber
    const partNumberArr = info.filter((entry) => {
      return /(?=.*\d).{8,}$/.test(entry);
    });

    if (partNumberArr.length > 1) {
      // we tried and just couldnt isolate a part number
      return false;
    }

    // look up part number in db
    const partNumber = partNumberArr[0];
    if (!partNumber) {
      this.log.trace('Part number not available - could not parse');
      return false;
    }

    const dbItem = await Item.query().where('manufacturerPartNumber', partNumber);
    if (!_.isEmpty(dbItem)) {
      return true;
    }
    return false;
  }


  isDuplicate({ item, duplicate }) {
    // if the price has changed, we should update it in the database to reflect changing market conditions
    if (item.price != duplicate.price) {
      return false;
    }
    // add other conditions here
    return true;
  }

  async processItems() {
    // get unprocessed items
    const startTime = process.hrtime();
    let duplicateCount = 0;
    let apiCalls = 0;

    // take 200 unprocessed items. This keeps us below the 5000 call limit / 24 hours period in ebay
    const items = await Item.query()
      .where('processed', false)
      .limit(process.env.ITEM_PROCESS_BATCH || 700);
    this.log.info({ count: items.length }, `Grabbed ${items.length} unprocessed items`);

    // for each item, hit the api and get the actual Item
    await Promise.mapSeries(items, async (item) => {
      if (!item.id) {
        this.log.warn({ item }, 'Item has no id, skipping');
        return;
      }

      // heuristic to determine whether to call ebay to get data
      // about item or mark as duplicate based on title
      const isDuplicate = await this.checkForDuplicate(item);

      if (isDuplicate) {
        this.log.debug({ itemId: item.ebayId }, '! This item determined to be a duplicate. Skipping the ebay call.');
        // delete the item from the database
        // we should be ok here since the item has not been related to any autos for compatibility purposes
        await Item.query().where('id', item.id).del();
        duplicateCount += 1;
        return;
      }

      // extra checks baked into the method
      const i = await this.getDetailsForItem({ itemId: item.ebayId });
      // we've spent the call
      apiCalls += 1;
      if (!i) {
        this.log.info('Item details not available due to error. Deleting');
        await Item.query().where('id', item.id).del();
        return;
      }

      // process item specifics
      const { interchangeNumbers, manufacturerPartNumber, manufacturerId, shouldDeleteItem } = await this.getItemSpecifics({ i, item });
      if (shouldDeleteItem) {
        this.log.warn('Found an existing item in the database with the same manufacturer part number. Deleting current item');
        // delete the actual item
        await Item.query().where('id', item.id).del();
        return;
      }

      // process compatibility
      const { autos } = await this.getItemCompatibility({ i, item });

      // add data to the item object
      item.autoCompatibilities = autos;
      item.interchangeNumbers = interchangeNumbers;
      item.processed = true;
      item.manufacturerId = manufacturerId;
      item.manufacturerPartNumber = manufacturerPartNumber;
      item.quantity = i.Quantity[0];

      const upsertedItem = await Item.query().upsertGraphAndFetch(item, {
        relate: true
      });
      this.log.trace({ upsertedItem }, 'item is now processed & related');
      this.log.debug(`Item ${upsertedItem.title} has been added. Processed: ${upsertedItem.processed}`);
    });

    const unprocessedItemCount = await Item.query().count('id').where('processed', false);
    const processedItemCount = await Item.query().count('id').where('processed', true);

    const [sec, ns] = process.hrtime(startTime);
    const elapsed = (ns + (sec * 1e9)) / 1e6;

    return {
      total: items.length, // the number pulled in the initial call
      processed: parseInt(processedItemCount[0].count), // how many are processed right now
      unprocessed: parseInt(unprocessedItemCount[0].count), // how many remain unprocessed
      time: elapsed / 1000 / 60, // the time it took in MINUTES
      duplicateCount, // the count of duplicates our heuristic was able to identify
      apiCalls, // the number of times we've called the TradingAPI
    };
  }

  async getItemCompatibility({ i, item }) {
    const autos = [];
    // check to make sure compatibilityListing exist
    let shouldQueryItemCompatibility = true;
    if (!i.ItemCompatibilityList) {
      this.log.warn({ item }, 'Does not have compatibility listings, skipping');
      shouldQueryItemCompatibility = false;
    }

    if (shouldQueryItemCompatibility) {
      // create Compatibility Associations
      this.log.trace({ count: i.ItemCompatibilityCount[0] }, 'Found compatibility listings');

      // shorthand
      const cList = i.ItemCompatibilityList[0].Compatibility;
      await Promise.mapSeries(cList, async (c) => {
        const list = c.NameValueList;
        let auto = {};
        list.filter(i => {
          return i.Name !== undefined
        }).map((kv) => {
          if (kv.Name[0] === 'Year') {
            auto.year = kv.Value[0];
          }
          if (kv.Name[0] === 'Make') {
            auto.make = kv.Value[0];
          }
          if (kv.Name[0] === 'Model') {
            auto.model = kv.Value[0];
          }
          if (kv.Name[0] === 'Trim') {
            auto.trim = kv.Value[0];
          }
          if (kv.Name[0] === 'Engine') {
            auto.engine = kv.Value[0];
          }
        });
        this.log.trace({ auto }, 'Parsed auto out');

        // query the database to determine where this auto already exists
        // skipUndefined() handles cases where trim/engine aren't in the eBay compatibility listing
        const dbAuto = await Auto.query()
          .skipUndefined()
          .where('year', auto.year)
          .where('make', auto.make)
          .where('model', auto.model)
          .where('trim', auto.trim)
          .where('engine', auto.engine)
          .first();

        if (dbAuto) {
          autos.push(dbAuto);
        } else {
          const storedAuto = await Auto.query().insertAndFetch({
            id: uuidv4(),
            trim: '',
            engine: '',
            ...auto,
          });
          autos.push(storedAuto);
        }
      });
    }

    return { autos };
  }

  async getItemSpecifics({ i, item }) {
    let interchangeNumbers = [];
    let manufacturerPartNumber;
    let manufacturerId;
    let shouldDeleteItem = false;

    // make sure the item has specifics
    let shouldQueryItemSpecifics = true;
    if (!i.ItemSpecifics) {
      this.log.warn({ item }, 'Requested item specifics but they were not present, skipping');
      shouldQueryItemSpecifics = false;
    }

    // update the current record with the manufacturerId and partNumber
    if (shouldQueryItemSpecifics) {
      const itemSpecifics = i.ItemSpecifics[0].NameValueList;
      let interchangeNumberString;
      itemSpecifics.map((kv) => {
        this.log.trace({ name: kv.Name[0], value: kv.Value[0] });
        if (kv.Name[0] === 'Manufacturer Part Number' && kv.Value[0] != 'Does Not Apply') {
          manufacturerPartNumber = this.getManufacturerPartNumber(kv.Value[0]);
        }
        if (kv.Name[0] === 'ID') {
          manufacturerId = kv.Name[0];
        }
        if (kv.Name[0] === 'Interchange Part Number') {
          interchangeNumberString = kv.Value[0];
        }
      });

      // temporarily disable interchange number lookups as our database schema is unstable
      /**
      if (manufacturerPartNumber !== undefined && interchangeNumberString !== undefined) {
        // account for just one interchange number
        const interchangeNumbers = this.getInterchangeNumbers(interchangeNumberString);
        await Promise.mapSeries(interchangeNumbers, async (num) => {
          const toInsert = {
            id: uuidv4(),
            interchangeNumber: num,
          };

          const inserted = await InterchangeNumber.query().insertAndFetch(toInsert).onConflict('interchangeNumber').ignore();
          interchangeNumbers.push(inserted);
        });
      }
       */


      // Second duplicate check. At this point we have already spent an API call, so we check again here
      // we already inserted this item into the database because when we first get all the items
      // we don't know their details. It's possible as we scrape, we will get duplicates because the ebayId
      // will always be unique. Our best chance of avoiding duplicates is to check to see whether 
      // the found manufacturerPartNumber matches anything we already have in the database.
      // If so, we choose to delete the current item out and prevent any duplicates
      if (manufacturerPartNumber) { // only query for duplicates when we actually have a manufacturer number
        const possibleDuplicateItem = await Item.query()
          .where('manufacturerPartNumber', manufacturerPartNumber)
          .where('seller', item.seller) // sellers should match - different items may be repair vs pick on same manufacturer number
          .skipUndefined();

        if (!_.isEmpty(possibleDuplicateItem)) {
          shouldDeleteItem = this.isDuplicate({ item, duplicate: possibleDuplicateItem[0] });
        }
      }
    }

    return { interchangeNumbers, manufacturerPartNumber, manufacturerId, shouldDeleteItem };
  }
}

module.exports = ItemDetailsManager;