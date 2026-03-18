'use strict';

const AutoService = require('../services/AutoService');
const router = require('express-promise-router')();
const { isAdmin, authMiddleware } = require('../middleware/Middleware');



router.get('/lookup', authMiddleware, async (req, res, next) => {
  const autoService = new AutoService();
  const response = await autoService.getCompatibilityTaxonomy({
    constraints: req.query,
  });
  res.status(200).send(response);
});

router.get('/distinct', authMiddleware, async (req, res, next) => {
  const autoService = new AutoService();

  const response = await autoService.getDistinctList({
    constraints: req.query,
  });

  res.status(200).send(response);
});

// get specific auto info
router.get('/:id', authMiddleware, async (req, res, next) => {
  const autoService = new AutoService();

  const response = await autoService.getAutoById({ id: req.params.id });

  res.status(200).send(response);
});

// pass an array of auto objects and get autoIds back
router.post('/get-auto-ids', authMiddleware, isAdmin, async (req, res, next) => {
  const autoService = new AutoService();

  const response = await autoService.getOrCreateAutos({ autos: req.body });

  res.status(201).send(response);
});

// create a new Auto row
// This can be used used externally in case we ever need to
router.post('/', authMiddleware, isAdmin, async (req, res, next) => {
  const autoService = new AutoService();

  const response = await autoService.createAuto({ body: req.body });

  res.status(201).send(response);
});

router.put('/:id', authMiddleware, isAdmin, async (req, res, next) => {
  const autoService = new AutoService();

  const response = await autoService.updateAuto({ id: req.params.id, body: req.body });

  res.status(200).send(response);
});

module.exports = router;