'use strict';

const Item = require('../../models/Item');
const {v4: uuidv4 } = require('uuid');
const InterchangeNumber = require('../../models/InterchangeNumber');


xdescribe('InterchangePartNumber', () => {
  let database;

  beforeEach(async() =>{
    database = await global.test.database();
  });

  describe('should work with many to one relationship', () => {
    it('work with multiple interchange numbers', async () => {      
      const intercNum1 = await InterchangeNumber.query().insertAndFetch({
        id: 'inter1',
        interchangeNumber: 1,
      });
      const intercNum2 = await InterchangeNumber.query().insertAndFetch({
        id: 'inter2',
        interchangeNumber: 2,
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
      }
      item.interchangeNumbers = [intercNum1, intercNum2];

      const response = await Item.query().insertGraphAndFetch(item, {
        relate: true,
      });

      expect(response).toBeDefined();
      expect(response.interchangeNumbers.length).toEqual(2);

      const interNumber = await InterchangeNumber.query().where('id', 'inter1').withGraphFetched('itemId');
      expect(interNumber).toBeDefined();
      expect(interNumber[0].itemId.length).toBe(1);

    });
  })
})