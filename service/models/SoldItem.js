'use strict';

const BaseModelWithTimestamps = require('./BaseModelWithTimestamps');

class SoldItem extends BaseModelWithTimestamps {
  static get tableName() {
    return 'SoldItem';
  }

  static get idColumn() {
    return 'id';
  }

  static get jsonAttributes() {
    return ['compatibility', 'interchangeNumbers'];
  }
}

module.exports = SoldItem;
