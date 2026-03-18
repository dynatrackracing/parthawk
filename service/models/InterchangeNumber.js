'use strict';

const { Model } = require('objection/lib/model/Model');
const BaseModelWithTimestamps = require('./BaseModelWithTimestamps');

class InterchangeNumber extends BaseModelWithTimestamps {
  static get tableName() {
    return 'InterchangeNumber';
  }

  static get relationMappings() {
    return {
      itemId: {
        relation: Model.ManyToManyRelation,
        modelClass: require('./Item'),
        join: {
          from: 'InterchangeNumber.id',
          through: {
            from: 'ItemInterchangeNumber.interchangePartId',
            to: 'ItemInterchangeNumber.manufacturerPartNumber',
          },
          to: 'Item.manufacturerPartNumber',
        }
      }
    }
  }
}

module.exports = InterchangeNumber;