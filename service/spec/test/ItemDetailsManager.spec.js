const ItemDetailsManager = require('../../managers/ItemDetailsManager');
const TradingAPI = require('../../ebay/TradingAPI');
const Auto = require('../../models/Auto');
const Item = require('../../models/Item');
const { Model } = require('objection');
const { items, item1 } = require('../data/item-data');
const { v4: uuidv4 } = require('uuid');
const _ = require('lodash');

describe('Item Details Manager tests', () => {
  let database;
  let manager;
  let id = 'id';

  beforeEach(async () => {
    database = await global.test.database();
    await Auto.query().del();
    await Item.query().del();
    await customDeleteStmts();

    manager = new ItemDetailsManager();
  });

  afterEach(async () => {
    await Auto.query().del();
    await Item.query().del();
    await customDeleteStmts();
  });

  async function customDeleteStmts() {
    const trx = Model.knex();
    await trx.raw('delete from "AutoItemCompatibility"');
  }

  describe('get details for item', () => {
    it('should get response from trading API', async () => {
      const tradingSpy = spyOn(TradingAPI.prototype, 'makeRequest').and.returnValue({
        GetItemResponse: {
          Ack: [
            'Success'
          ],
          Item: [
            {
              title: 'my item'
            }
          ]
        }
      });
      const response = await manager.getDetailsForItem(id);
      expect(response).toEqual({
        title: 'my item',
      });
      expect(tradingSpy).toHaveBeenCalledTimes(1);
    });

    it('should return null if there is an error', async () => {
      const tradingSpy = spyOn(TradingAPI.prototype, 'makeRequest').and.returnValue({
        GetItemResponse: {
          Ack: [
            'Failure'
          ],
          Item: [
            {
              title: 'my item'
            }
          ],
          Errors: [
            {
              LongMessage: ['Error']
            }
          ]
        }
      });
      const response = await manager.getDetailsForItem(id);
      expect(response).toEqual(null);
      expect(tradingSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('parse interchange numbers', () => {

  });

  describe('parse manufacturer part number', () => {
    it('should get the manufacturer part number', () => {
      let string = 'ABCED-34853';
      const response = manager.getManufacturerPartNumber(string);
      expect(response).toEqual(string);
    });
  });

  describe('check for duplicates', () => {
    it('checks for seller', async () => {
      item1.seller = 'not importapart';
      const response = await manager.checkForDuplicate(item1);
      expect(response).toEqual(false);
    });

    it('checks for category title', async () => {
      const item = {
        categoryTitle: 'BLEH'
      };
      const response = await manager.checkForDuplicate(item);
      expect(response).toEqual(false);
    });

    it('checks regex on array', async () => {
      const item = items[4];
      const response = await manager.checkForDuplicate(item);
      expect(response).toEqual(false);
    });

    it('should query database for manufacturer part number in database', async () => {
      const item = items[4];
      await Item.query().insert({
        ...item,
        manufacturerPartNumber: 55565020
      });

      const response = await manager.checkForDuplicate(item);
      expect(response).toEqual(true);
    });
  });

  describe('should insert duplicates', () => {
    it('should not be dupe if price is different', () => {
      const item = item1;
      const duplicate = {
        ...item1,
        price: 200,
      }

      const response = manager.isDuplicate({ item, duplicate });
      expect(response).toEqual(false);
    });
  });

  describe('process items flow', () => {
    it('should work happy path', async () => {
      const unprocessedItem = items[0];
      await Item.query().insert(unprocessedItem);

      spyOn(ItemDetailsManager.prototype, 'getDetailsForItem').and.returnValue(item1);

      const response = await manager.processItems();

      expect(response).toBeDefined();
      expect(response.total).toEqual(1)
      expect(response.processed).toEqual(1);

      const item = await Item.query().where('id', unprocessedItem.id).withGraphFetched('autoCompatibilities').first();
      expect(item.autoCompatibilities).toBeDefined();
      expect(item.autoCompatibilities.length).toEqual(3);

      const trx = Model.knex();
      const customQuery = await trx.raw('select * from "AutoItemCompatibility"');
      expect(customQuery.rows.length).toEqual(3);
      const newcustomQuery = await  trx.raw(`select * from "AutoItemCompatibility" where "itemId" = '${item.id}'`);
      expect(newcustomQuery.rows.length).toEqual(3);
    });

    it('should handle duplicate entries', async () => {
      const unprocessedItem = items[0];
      await Item.query().insert(unprocessedItem);

      spyOn(ItemDetailsManager.prototype, 'getDetailsForItem').and.returnValue(item1);

      await manager.processItems();

      let modifiedDupe = _.clone(items[0]);
      const newId = uuidv4();
      modifiedDupe.id = newId;
      modifiedDupe.ebayId = 1;

      await Item.query().insert(modifiedDupe);

      await manager.processItems();


      const item = await Item.query().where('id', unprocessedItem.id).withGraphFetched('autoCompatibilities').first();
      const trx = Model.knex();
      const customQuery = await trx.raw('select * from "AutoItemCompatibility"');
      expect(customQuery.rows.length).toEqual(3);
      const newcustomQuery = await  trx.raw(`select * from "AutoItemCompatibility" where "itemId" = '${item.id}'`);
      expect(newcustomQuery.rows.length).toEqual(3);
    });
  });

  describe('get item specifics', () => {
    it('should return empty values if no specifics exist', async () => {
      const i = _.clone(item1);
      const item = items[0];

      delete i.ItemSpecifics;

      const response = await manager.getItemSpecifics({ i, item });
      expect(response).toBeDefined();
      const { interchangeNumbers, manufacturerPartNumber, manufacturerId, shouldDeleteItem } = response;
      expect(interchangeNumbers).toEqual([]);
      expect(manufacturerPartNumber).not.toBeDefined();
      expect(manufacturerId).not.toBeDefined();
      expect(shouldDeleteItem).toEqual(false);
    });

    it('should parse out manufacturer part number', async () => {
      const i = _.clone(item1);
      const item = items[0];

      const response = await manager.getItemSpecifics({ i, item });
      expect(response).toBeDefined();
      const { interchangeNumbers, manufacturerPartNumber, manufacturerId, shouldDeleteItem } = response;

      expect(interchangeNumbers).toEqual([]);
      expect(manufacturerPartNumber).toEqual('88210-50030');
      expect(manufacturerId).toEqual('ID');
      expect(shouldDeleteItem).toEqual(false);
      
    });

    it('should delete item if manufacturer part number already exists in db', async () => {
      const i = _.clone(item1);
      const item = items[0];

      item.manufacturerPartNumber = '88210-50030';
      await Item.query().insert(item);

      const response = await manager.getItemSpecifics({ i, item });
      expect(response).toBeDefined();
      const { interchangeNumbers, manufacturerPartNumber, manufacturerId, shouldDeleteItem } = response;

      expect(interchangeNumbers).toEqual([]);
      expect(manufacturerPartNumber).toEqual('88210-50030');
      expect(manufacturerId).toEqual('ID');
      expect(shouldDeleteItem).toEqual(true);
    });
  });

  describe('get item compatibility', () => {
    it('should empty array if compatibility does not exist', async () => {
      const i = _.clone(item1);
      const item = items[0];

      delete i.ItemCompatibilityList;

      const { autos } = await manager.getItemCompatibility({ i, item });
      expect(autos).toEqual([]);
    });

    it('should parse out autos from compatibility listings', async () => {
      const i = item1;
      const item = items[0];

      const { autos } = await manager.getItemCompatibility({ i, item });
      expect(autos).toBeDefined();
      expect(autos.length).toBe(3);
    });

    it('should only insert 1 row for duplicate autos and return the same uuid', async () => {
      const i = item1;
      const item = items[0];

      const { autos } = await manager.getItemCompatibility({ i, item });
      expect(autos).toBeDefined();
      expect(autos.length).toBe(3);

      const ids = autos.map(a => a.id);

      const { autos: newAutos } = await manager.getItemCompatibility({ i, item });
      const newIds = newAutos.map(a => a.id);

      expect(ids.sort()).toEqual(newIds.sort());
    });
  });
});