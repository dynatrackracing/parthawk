'use strict';

const { Model } = require('objection');
const BaseModelWithTimestamps = require('./BaseModelWithTimestamps');

class Auto extends BaseModelWithTimestamps {
  static get tableName() {
    return 'Auto';
  }

  static get relationMappings() {
    return {
      itemCompatibilities: {
        relation: Model.ManyToManyRelation,
        modelClass: require('./Item'),
        join: {
          from: 'Auto.id',
          through: {
            from: 'AutoItemCompatibility.autoId',
            to: 'AutoItemCompatibility.itemId'
          },
          to: 'Item.id'
        }
      }
    }
  }
}

module.exports = Auto;