'use strict';

const router = require('express-promise-router')();
const ItemLookupService = require('../services/ItemLookupService');
const { authMiddleware } = require('../middleware/Middleware');

router.get('/item', authMiddleware, async (req, res, next) => {
  const itemLookupService = new ItemLookupService();

  const response = await itemLookupService.getFilter({ field: req.query.field });

  res.status(200).send(response);
});


module.exports = router;