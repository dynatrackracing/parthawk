'use strict';

const BaseModel = require('./BaseModel');

class PriceSnapshot extends BaseModel {
  static get tableName() {
    return 'PriceSnapshot';
  }

  static get idColumn() {
    return 'id';
  }
}

module.exports = PriceSnapshot;
