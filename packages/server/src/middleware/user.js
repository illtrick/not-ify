const db = require('../services/db');

/**
 * User identification middleware.
 * Reads X-User-Id header (or ?userId query param as fallback).
 * Defaults to 'default' if missing or invalid.
 * Sets req.userId for downstream handlers.
 */
function userMiddleware(req, res, next) {
  const requestedId = req.headers['x-user-id'] || req.query.userId;
  if (requestedId && db.isValidUser(requestedId)) {
    req.userId = requestedId;
  } else {
    req.userId = db.getDefaultUserId() || 'default';
  }
  next();
}

module.exports = userMiddleware;
