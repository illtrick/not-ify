'use strict';

/**
 * Simple in-memory sliding window rate limiter.
 * @param {object} opts
 * @param {number} opts.windowMs — window duration in ms (default 10000)
 * @param {number} opts.max — max requests per window (default 20)
 */
function rateLimit({ windowMs = 10000, max = 20 } = {}) {
  const hits = new Map(); // key → [timestamp, timestamp, ...]

  // Periodic cleanup to prevent memory leak
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of hits) {
      const valid = timestamps.filter(t => now - t < windowMs);
      if (valid.length === 0) hits.delete(key);
      else hits.set(key, valid);
    }
  }, windowMs * 2);
  if (cleanup.unref) cleanup.unref();

  return function rateLimitMiddleware(req, res, next) {
    const key = req.userId || req.ip;
    const now = Date.now();
    const timestamps = (hits.get(key) || []).filter(t => now - t < windowMs);

    if (timestamps.length >= max) {
      return res.status(429).json({ error: 'Too many requests, try again shortly' });
    }

    timestamps.push(now);
    hits.set(key, timestamps);
    next();
  };
}

module.exports = rateLimit;
