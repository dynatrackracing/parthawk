'use strict';

const { Model } = require('objection');
const BaseModelWithTimestamps = require('./BaseModelWithTimestamps');

class Item extends BaseModelWithTimestamps {
  static get tableName() {
    return 'Item';
  }

  static getBooleanAttributes(){
    return ['processed'];
  }

  static get relationMappings() {
    return {
      autoCompatibilities: {
        relation: Model.ManyToManyRelation,
        modelClass: require('./Auto'),
        join: {
          from: 'Item.id',
          through: {
            from: 'AutoItemCompatibility.itemId',
            to: 'AutoItemCompatibility.autoId',
          },
          to: 'Auto.id',
        }
      },
      interchangeNumbers: {
        relation: Model.ManyToManyRelation,
        modelClass: require('./InterchangeNumber'),
        join: {
          from: 'Item.manufacturerPartNumber',
          through:{
            from: 'ItemInterchangeNumber.manufacturerPartNumber',
            to: 'ItemInterchangeNumber.interchangePartId'
          },
          to: 'InterchangeNumber.id'
        }
      }
    }
  }
}

module.exports = Item;