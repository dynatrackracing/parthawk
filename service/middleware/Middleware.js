'use strict';

const { log } = require('../lib/logger');

// Lazy load firebase admin to avoid requiring credentials when DISABLE_AUTH is true
let firebaseAdmin = null;
function getFirebaseAdmin() {
  if (!firebaseAdmin) {
    try {
      firebaseAdmin = require('./firebase/firebase-config');
    } catch (err) {
      log.warn({ err: err.message }, 'Firebase admin not configured');
      return null;
    }
  }
  return firebaseAdmin;
}

async function authMiddleware(req, res, next) {
  // Bypass auth if DISABLE_AUTH is set (any environment)
  if (process.env.DISABLE_AUTH === 'true') {
    req.user = { isAdmin: true, email: 'admin@dynatrack.local' };
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.sendStatus(401);
  }

  const token = authHeader && authHeader.split(' ')[1];

  try {
    const admin = getFirebaseAdmin();
    if (!admin) {
      // No Firebase configured and auth not disabled — allow in dev
      if (process.env.NODE_ENV === 'development') {
        req.user = { isAdmin: true };
        return next();
      }
      return res.sendStatus(401);
    }

    const decodeResult = await admin.auth().verifyIdToken(token);
    req.user = {
      email: decodeResult?.email,
      isAdmin: true, // TODO: check against users table
    };
    return next();
  } catch (err) {
    log.warn({ err: err.message }, 'Auth failed');
    return res.sendStatus(401);
  }
}

function isAdmin(req, res, next) {
  if (!req.user) return res.sendStatus(403);
  if (!req.user.isAdmin) return res.sendStatus(403);
  next();
}

module.exports = { authMiddleware, isAdmin };
