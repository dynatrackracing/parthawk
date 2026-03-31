'use strict';

const BaseModelWithTimestamps = require('./BaseModelWithTimestamps');

class EbayMessage extends BaseModelWithTimestamps {
  static get tableName() {
    return 'ebay_messages';
  }

  static get idColumn() {
    return 'id';
  }
}

module.exports = EbayMessage;
