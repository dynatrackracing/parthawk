'use strict';

const Joi = require('@hapi/joi');

const autoCreateSchema = Joi.object({
  make: Joi.string().required(),
  model: Joi.string().required(),
  year: Joi.string().required(),
  trim: Joi.string().optional(),
  engine: Joi.string().optional(),
});

module.exports = {
  autoCreateSchema,
}