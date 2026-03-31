'use strict';

const BaseModel = require('./BaseModel');

class TrimValueValidation extends BaseModel {
  static get tableName() {
    return 'trim_value_validation';
  }

  static get idColumn() {
    return 'id';
  }
}

module.exports = TrimValueValidation;
