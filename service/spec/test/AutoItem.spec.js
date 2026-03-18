'use strict';

const Auto = require('../../models/Auto');
const Item = require('../../models/Item');
const { Model } = require('objection');
const { v4: uuidv4 } = require('uuid');
const AutoService = require('../../services/AutoService');

describe('AutoItem', () => {
  let database;

  beforeEach(async () => {
    database = await global.test.database();
    await Auto.query().del();
    await Item.query().del();
    await customDeleteStmts();
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

  describe('auto', () => {
    it('should insert simple auto', async () => {
      await Auto.query().insert({
        id: uuidv4(),
        year: '2012',
        make: 'Acura',
        model: 'TSX',
        engine: 'v4',
        trim: 'L',
      });

      const response = await Auto.query();
      const auto = response[0];
      expect(auto).toBeDefined();
      expect(auto.year).toEqual(2012);
      expect(auto.make).toEqual('Acura');
      expect(auto.model).toEqual('TSX');
      expect(auto.engine).toEqual('v4');
    });
  });

  describe('item', () => {
    it('creates an item', async () => {
      await Item.query().insert({
        id: uuidv4(),
        ebayId: '123',
        price: 120.99,
        quantity: 1,
        title: 'My item',
        categoryId: 1,
        categoryTitle: 'Parts',
        seller: 'dynatrack',
        manufacturerPartNumber: '123',
        manufacturerId: 'ID001',
      });

      const response = await Item.query();
      const item = response[0];
      expect(item).toBeDefined();
    });

    it('handles duplicate items', async () => {
      const item1 = {
        id: 'item1',
        ebayId: '123',
        price: 120.99,
        quantity: 1,
        title: 'My item',
        categoryId: 1,
        categoryTitle: 'Parts',
        seller: 'dynatrack',
        manufacturerPartNumber: '123',
        manufacturerId: 'ID001',
      };

      const item2 = {
        id: 'item2',
        ebayId: '123',
        price: 120.99,
        quantity: 1,
        title: 'My item',
        categoryId: 1,
        categoryTitle: 'Parts',
        seller: 'dynatrack',
        manufacturerPartNumber: '123',
        manufacturerId: 'ID002',
      }

      await Item.query().insert(item1).onConflict('ebayId').ignore();
      await Item.query().insert(item2).onConflict('ebayId').ignore();

      const response = await Item.query();
      expect(response.length).toBe(1);
      // should have inserted the first one and dropped the second one
      expect(response[0].manufacturerId).toEqual('ID001')
      expect(response[0].id).toEqual('item1');
    });
  });

  describe('auto item compatibility', () => {
    it('should make many many to associations work', async () => {
      // first we create the cars from the item
      // one item can be compatible with many cars
      // one car can have many compatible items
      // each item sourced has a CompatibilityList with an Auto[] of cars
      // in our flow, we would insert those first and then get the ids
      // then create the item.

      const acura1 = await Auto.query().insertAndFetch({
        id: 'acura1',
        year: '2012',
        make: 'Acura',
        model: 'TSX',
        engine: 'v4',
        trim: 'L',
      });

      const acura2 = await Auto.query().insertAndFetch({
        id: 'acura2',
        year: '2012',
        make: 'Acura',
        model: 'TSX',
        engine: 'v6',
        trim: 'L',
      });

      const item = {
        id: 'item1',
        ebayId: '123',
        price: 120.99,
        quantity: 1,
        title: 'My item',
        categoryId: 1,
        categoryTitle: 'Parts',
        seller: 'dynatrack',
        manufacturerPartNumber: '123',
        manufacturerId: 'ID001',
      };

      item.autoCompatibilities = [acura1, acura2];

      await Item.query().insertGraphAndFetch(item, {
        relate: true,
      });

      const response = await Item.query().where('ebayId', '123').withGraphFetched('autoCompatibilities');
      expect(response).toBeDefined();
      expect(response[0].autoCompatibilities.length).toEqual(2);


      const autoResponse = await Auto.query().withGraphFetched('itemCompatibilities');
      expect(autoResponse).toBeDefined();
      expect(autoResponse[0].itemCompatibilities.length).toEqual(1);
    });

    it('should cascade delete on item delete correctly', async() => {
      const acura1 = await Auto.query().insertAndFetch({
        id: 'acura1',
        year: '2012',
        make: 'Acura',
        model: 'TSX',
        engine: 'v4',
        trim: 'L',
      });

      const acura2 = await Auto.query().insertAndFetch({
        id: 'acura2',
        year: '2012',
        make: 'Acura',
        model: 'TSX',
        engine: 'v6',
        trim: 'L',
      });

      const item = {
        id: 'item1',
        ebayId: '123',
        price: 120.99,
        quantity: 1,
        title: 'My item',
        categoryId: 1,
        categoryTitle: 'Parts',
        seller: 'dynatrack',
        manufacturerPartNumber: '123',
        manufacturerId: 'ID001',
      };

      item.autoCompatibilities = [acura1, acura2];

      await Item.query().insertGraphAndFetch(item, {
        relate: true,
      });

      const response = await Item.query().where('id', 'item1').del();

      expect(response).toBeDefined();

      const items = await Item.query();
      expect(items.length).toBe(0);

      const trx = Model.knex();
      const compat = await trx.raw(`select * from "AutoItemCompatibility"`);

      expect(compat.rowCount).toBe(0);

      const autos = await Auto.query();
      expect(autos.length).toEqual(2);

    });


    it('should cascade delete on auto delete correctly', async() => {
      const acura1 = await Auto.query().insertAndFetch({
        id: 'acura1',
        year: '2012',
        make: 'Acura',
        model: 'TSX',
        engine: 'v4',
        trim: 'L',
      });

      const acura2 = await Auto.query().insertAndFetch({
        id: 'acura2',
        year: '2012',
        make: 'Acura',
        model: 'TSX',
        engine: 'v6',
        trim: 'L',
      });

      const item = {
        id: 'item1',
        ebayId: '123',
        price: 120.99,
        quantity: 1,
        title: 'My item',
        categoryId: 1,
        categoryTitle: 'Parts',
        seller: 'dynatrack',
        manufacturerPartNumber: '123',
        manufacturerId: 'ID001',
      };

      item.autoCompatibilities = [acura1, acura2];

      await Item.query().insertGraphAndFetch(item, {
        relate: true,
      });

      const response = await Auto.query().where('id', 'acura1').del();

      expect(response).toBeDefined();

      const auto2 = await Auto.query().where('id', 'acura2');
      expect(auto2).toBeDefined();

      const trx = Model.knex();
      const compat = await trx.raw(`select * from "AutoItemCompatibility"`);

      expect(compat.rowCount).toBe(1);

      const items = await Item.query();
      expect(items.length).toEqual(1);
    });
  });

  describe('new autos', () => {
    it('should only get autos that have parts attached to them', async () => {
      // create two cars
      const acura1 = await Auto.query().insertAndFetch({
        id: 'acura1',
        year: '2012',
        make: 'Acura',
        model: 'TSX',
        engine: 'v4',
        trim: 'L',
      });

      const acura2 = await Auto.query().insertAndFetch({
        id: 'acura2',
        year: '2012',
        make: 'Acura',
        model: 'TSX',
        engine: 'v6',
        trim: 'L',
      });

      const item = {
        id: 'item1',
        ebayId: '123',
        price: 120.99,
        quantity: 1,
        title: 'My item',
        categoryId: 1,
        categoryTitle: 'Parts',
        seller: 'dynatrack',
        manufacturerPartNumber: '123',
        manufacturerId: 'ID001',
      };

      // relate only one car
      item.autoCompatibilities = [acura1];

      await Item.query().insertGraphAndFetch(item, {
        relate: true,
      });

      // verify there's two cars
      const cars = await Auto.query();
      expect(cars.length).toEqual(2);
      // only get those cars that have items attached to them
      const response = await Auto.query().innerJoin('AutoItemCompatibility', 'Auto.id', 'AutoItemCompatibility.autoId');
      expect(response.length).toEqual(1);
      expect(response[0].id).toEqual('acura1');
    });
  });

  describe('get or create autos', () => {
    xit('should get autos out of the database if they all exist', async () => {
      const auto1 = await Auto.query().insert({
        id: 'auto1',
        year: '2000',
        make: 'Toyota',
        model: 'Corolla',
        trim: 'Base',
        engine: 'v4',
      });

      const auto2 = await Auto.query().insert({
        id: 'auto2',
        year: '2000',
        make: 'Toyota',
        model: 'Corolla',
        trim: 'Luxury',
        engine: 'v4',
      });

      let autos = await Auto.query();
      expect(autos.length).toBe(2);

      const autoService = new AutoService();

      const response = await autoService.getOrCreateAutos({
        autos: [
          {
            year: '2000',
            make: 'Toyota',
            model: 'Corolla',
            trim: 'Base',
          },
          {
            year: '2000',
            make: 'Toyota',
            model: 'Corolla',
            trim: 'Luxury',
          }
        ],
      });

      expect(response).toBeDefined();
      expect(response).toEqual(['auto1', 'auto2']);
      
      autos = await Auto.query();
      expect(autos.length).toBe(2);
    });

    it('should insert a car if necessary', async () => {
      const taxonomySpy = spyOn(AutoService.prototype, 'getCompatibilityTaxonomy').and.returnValue([
        {
          value: 'v4',
        },
        {
          value: 'v6'
        }
      ]);

      const auto1 = await Auto.query().insert({
        id: 'auto1',
        year: '2000',
        make: 'Toyota',
        model: 'Corolla',
        trim: 'Base',
        engine: 'v4',
      });

      const autoService = new AutoService();
      const response = await autoService.getOrCreateAutos({
        autos: [
          {
            year: '2000',
            make: 'Toyota',
            model: 'Corolla',
            trim: 'Base',
          },
          {
            year: '2012',
            make: 'Nissan',
            model: 'Titan',
            trim: 'Luxury',
          }
        ],
      });

      expect(response.length).toEqual(3);
      const autos = await Auto.query();
      expect(autos.length).toBe(3);
    });
  });
});
