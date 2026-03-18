'use strict';

const Joi = require('@hapi/joi');

const itemCreateSchema = Joi.object({
  price: Joi.number().required(),
  title: Joi.string().required(),
  notes: Joi.string().optional(),
  pictureUrl: Joi.string().optional().allow(''),
  categoryId: Joi.string().optional(),
  categoryTitle: Joi.string().optional(),
  difficulty: Joi.number().min(1).max(5).optional(),
  salesEase: Joi.number().min(1).max(5).optional(),
  autoIds: Joi.array().items(Joi.string()).optional(),
  manufacturerPartNumber: Joi.string().optional().allow(''),
});

module.exports = {
  itemCreateSchema,
}