'use strict';

const BaseModelWithTimestamps = require('./BaseModelWithTimestamps');

class EbayMessageTemplate extends BaseModelWithTimestamps {
  static get tableName() {
    return 'ebay_message_templates';
  }

  static get idColumn() {
    return 'id';
  }
}

module.exports = EbayMessageTemplate;
