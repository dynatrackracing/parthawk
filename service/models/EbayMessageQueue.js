'use strict';

const BaseModel = require('./BaseModel');

class EbayMessageQueue extends BaseModel {
  static get tableName() {
    return 'ebay_message_queue';
  }

  static get idColumn() {
    return 'id';
  }
}

module.exports = EbayMessageQueue;
