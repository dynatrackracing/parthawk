'use strict';

const { Model } = require('objection');
const Joi = require('@hapi/joi');

const boolSchema = Joi.boolean()
  .truthy(1)
  .falsy(0);

class BaseModel extends Model {
  static get booleanAttributes() {
    // Default set of boolean attributes.
    return [];
  }

  static normalizeBooleanAttributes(json) {
    if (!this.booleanAttributes
      || this.booleanAttributes.length === 0) {
      return json;
    }

    this.booleanAttributes.forEach((attrName) => {
      // Skip if the json does not have the property
      if (!Object.prototype.hasOwnProperty.call(json, attrName)) {
        return;
      }

      // eslint-disable-next-line no-param-reassign
      json[attrName] = Joi.attempt(json[attrName], boolSchema);
    });

    return json;
  }

  $setDatabaseJson(json) {
    // Normalize all boolean attributes.
    const normalizedJson = this.constructor
      .normalizeBooleanAttributes(json);
    return super.$setDatabaseJson(normalizedJson);
  }

  $formatDatabaseJson(json) {
    const ret = super.$formatDatabaseJson(json);
    // Normalize all boolean attributes.
    const v = this.constructor.normalizeBooleanAttributes(ret);
    return v;
  }
}

module.exports = BaseModel;