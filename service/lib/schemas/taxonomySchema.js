'use strict';

const Joi = require("@hapi/joi");

const selectSchema = Joi.string().valid('Year', 'Make', 'Model', 'Trim', 'Engine');

module.exports = {
  selectSchema,
};