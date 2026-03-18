'use strict';

const ItemLookupService = require('../services/ItemLookupService');
const router = require('express-promise-router')();
const { isAdmin, authMiddleware } = require('../middleware/Middleware');

router.get('/', authMiddleware, async (req, res, next) => {
  const itemService = new ItemLookupService({ user: req.user });

  const response = await itemService.getAutosForItem({ partNumber: req.query.partNumber });

  res.status(200).send(response);
});

router.get('/auto', authMiddleware, async (req, res, next) => {
  const itemService = new ItemLookupService({ user: req.user });

  const response = await itemService.getItemsForAuto({
    year: req.query.year,
    make: req.query.make,
    model: req.query.model,
    trim: req.query.trim,
    engine: req.query.engine,
  });

  res.status(200).send(response);
});


router.get('/latest', authMiddleware, async (req, res, next) => {
  const itemService = new ItemLookupService({ user: req.user });

  const response = await itemService.getLatestItems({
    count: req.query.count,
  });

  res.status(200).send(response);
});

router.get('/:id', authMiddleware, async (req, res, next) => {
  const itemService = new ItemLookupService({ user: req.user });

  const response = await itemService.getItemById({ id: req.params.id });

  res.status(200).send(response);
});

router.get('/lookup/search', authMiddleware, async (req, res, next) => {
  const itemService = new ItemLookupService({ user: req.user });

  const response = await itemService.searchItems({
    constraints: req.query
  });

  res.status(200).send(response);
});

router.put('/:id', authMiddleware, isAdmin, async (req, res, next) => {
  const itemService = new ItemLookupService({ user: req.user });

  const response = await itemService.update({ id: req.params.id, body: req.body });

  res.status(200).send(response);

  next();
});

router.post('/', authMiddleware, isAdmin, async (req, res, next) => {
  const itemService = new ItemLookupService({ user: req.user });

  const response = await itemService.createItem({ body: req.body });

  res.status(201).send(response);

  next();
});

router.delete('/:id', authMiddleware, isAdmin, async (req, res, next) => {
  const itemService = new ItemLookupService({ user: req.user });

  const response = await itemService.deleteItemById({ id: req.params.id });

  res.status(200).send({ deleted: response });

  next();
});

module.exports = router;