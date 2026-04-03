'use strict';

const router = require('express-promise-router')();
const { makeToken, COOKIE_NAME, COOKIE_MAX_AGE } = require('../middleware/authGate');

router.post('/login', (req, res) => {
  const { password } = req.body;
  const expected = process.env.DARKHAWK_PASSWORD;

  if (!expected) {
    console.error('DARKHAWK_PASSWORD env var not set!');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  if (password === expected) {
    const token = makeToken();
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
      path: '/',
    });
    return res.json({ success: true });
  }

  return res.status(401).json({ error: 'Invalid password' });
});

router.get('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.redirect('/login');
});

module.exports = router;
