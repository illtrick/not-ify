const db = require('../services/db');

/**
 * User identification middleware.
 * Reads X-User-Id header (or ?userId query param as fallback).
 * Defaults to 'default' if missing or invalid.
 * Sets req.userId for downstream handlers.
 */
function userMiddleware(req, res, next) {
  const userId = req.headers['x-user-id'] || req.query.userId || 'default';
  req.userId = db.isValidUser(userId) ? userId : 'default';
  next();
}

module.exports = userMiddleware;
