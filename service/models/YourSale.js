'use strict';

const BaseModelWithTimestamps = require('./BaseModelWithTimestamps');

class YourSale extends BaseModelWithTimestamps {
  static get tableName() {
    return 'YourSale';
  }

  static get idColumn() {
    return 'id';
  }
}

module.exports = YourSale;
