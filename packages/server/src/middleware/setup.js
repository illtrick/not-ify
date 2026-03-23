'use strict';

const db = require('../services/db');

let _setupComplete = null;

function setupMiddleware(req, res, next) {
  if (_setupComplete === null) {
    _setupComplete = db.isSetupComplete();
  }

  if (_setupComplete) return next();

  const path = req.path || req.originalUrl || '';
  if (path === '/api/health' ||
      path.startsWith('/api/setup') ||
      !path.startsWith('/api/')) {
    return next();
  }

  return res.status(403).json({
    error: 'setup_required',
    setupUrl: '/setup',
    message: 'Please complete the setup wizard to get started.',
  });
}

setupMiddleware._resetCache = function() {
  _setupComplete = null;
};

setupMiddleware._markComplete = function() {
  _setupComplete = true;
};

module.exports = setupMiddleware;
