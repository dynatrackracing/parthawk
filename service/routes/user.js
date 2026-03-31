'use strict';

const UserManager = require('../managers/UserManager');
const router = require('express-promise-router')();
const { isAdmin, authMiddleware } = require('../middleware/Middleware');

router.post('/login', async (req, res, next) => {

  const userManager = new UserManager();

  const response = await userManager.getOrCreateUser({
    user: {
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      email: req.body.email,
      imageUrl: req.body.imageUrl,
    },
  });

  res.status(201).send(response);
});

router.get('/:id', authMiddleware, async (req, res, next) => {
  const userManager = new UserManager();

  // the id is the email
  const payload = {
    email: req.params.id
  }

  const response = await userManager.getUser({ user: payload });


  res.status(200).send(response);
});

router.get('/', authMiddleware, isAdmin, async (req, res, next) => {
  const userManager = new UserManager();

  const response = await userManager.getAllUsers();

  res.status(200).send(response);
});

router.put('/:id', authMiddleware, isAdmin, async (req, res, next) => {
  const userManager = new UserManager();

  const response = await userManager.modifyUser({ user: req.params.id, body: req.body });

  res.sendStatus(200);
});
router.delete('/:id', authMiddleware, isAdmin, async (req, res, next) => {
  const userManager = new UserManager();

  const response = await userManager.deleteUser({ user: req.params.id });

  return res.status(204).send();
});

module.exports = router;