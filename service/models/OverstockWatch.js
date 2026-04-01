'use strict';

const BaseModelWithTimestamps = require('./BaseModelWithTimestamps');

class OverstockWatch extends BaseModelWithTimestamps {
  static get tableName() {
    return 'overstock_watch';
  }

  static get idColumn() {
    return 'id';
  }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['ebay_item_id', 'initial_quantity'],
      properties: {
        id: { type: 'integer' },
        ebay_item_id: { type: 'string', minLength: 1, maxLength: 64 },
        title: { type: 'string', maxLength: 512 },
        part_number_base: { type: ['string', 'null'], maxLength: 128 },
        current_quantity: { type: 'integer', default: 0 },
        initial_quantity: { type: 'integer', minimum: 3 },
        restock_target: { type: 'integer', minimum: 0, default: 1 },
        status: { type: 'string', enum: ['watching', 'triggered', 'acknowledged'], default: 'watching' },
        triggered_at: { type: ['string', 'null'] },
        acknowledged_at: { type: ['string', 'null'] },
        notes: { type: ['string', 'null'] },
      },
    };
  }
}

module.exports = OverstockWatch;
