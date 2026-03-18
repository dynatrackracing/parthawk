'use strict';

const BaseModelWithTimestamps = require('./BaseModelWithTimestamps');

class SoldItemSeller extends BaseModelWithTimestamps {
  static get tableName() {
    return 'SoldItemSeller';
  }

  static get idColumn() {
    return 'name';
  }
}

module.exports = SoldItemSeller;
