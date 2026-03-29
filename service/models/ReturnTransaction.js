'use strict';

const BaseModel = require('./BaseModel');

class ReturnTransaction extends BaseModel {
  static get tableName() { return 'return_transaction'; }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['transaction_date', 'item_title', 'abs_gross'],
      properties: {
        id: { type: 'integer' },
        transaction_date: { type: 'string', format: 'date' },
        order_number: { type: ['string', 'null'] },
        buyer_username: { type: ['string', 'null'] },
        buyer_name: { type: ['string', 'null'] },
        ship_state: { type: ['string', 'null'] },
        item_title: { type: 'string' },
        custom_label: { type: ['string', 'null'] },
        part_type: { type: ['string', 'null'] },
        make: { type: ['string', 'null'] },
        abs_gross: { type: 'number' },
        is_formal_return: { type: 'boolean' },
        has_inad_fee: { type: 'boolean' },
      }
    };
  }
}

module.exports = ReturnTransaction;
