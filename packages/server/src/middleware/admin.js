const db = require('../services/db');

function adminGuard(req, res, next) {
  if (!db.isAdmin(req.userId)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = adminGuard;
