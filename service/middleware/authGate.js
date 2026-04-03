'use strict';

const crypto = require('crypto');

const COOKIE_NAME = 'dh_session';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

// Routes that bypass auth entirely
const PUBLIC_PATHS = [
  '/login',
  '/auth/login',
  '/auth/logout',
  '/puller',
  '/private/ebay-challenger-api',
  '/test',
  '/api/health-check',
];

function getSecret() {
  return process.env.DARKHAWK_PASSWORD || 'changeme';
}

function makeToken() {
  const payload = Date.now().toString();
  const hmac = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
  return payload + '.' + hmac;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
  if (sig !== expected) return false;
  const created = parseInt(payload, 10);
  if (isNaN(created)) return false;
  return (Date.now() - created) < COOKIE_MAX_AGE;
}

function authGate(req, res, next) {
  const path = req.path;

  // Let public paths through
  if (PUBLIC_PATHS.some(p => path === p || path.startsWith(p + '/'))) {
    return next();
  }

  // Let login page through
  if (path === '/admin/login.html') {
    return next();
  }

  // Check cookie
  const token = parseCookie(req.headers.cookie, COOKIE_NAME);
  if (verifyToken(token)) {
    return next();
  }

  // Not authenticated — redirect HTML requests, 401 API requests
  const acceptsHtml = (req.headers.accept || '').includes('text/html');
  if (acceptsHtml) {
    return res.redirect('/login');
  }
  return res.status(401).json({ error: 'Not authenticated' });
}

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.split(';').find(c => c.trim().startsWith(name + '='));
  return match ? match.trim().substring(name.length + 1) : null;
}

module.exports = { authGate, makeToken, verifyToken, COOKIE_NAME, COOKIE_MAX_AGE };
