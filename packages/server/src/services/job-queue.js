'use strict';

const { getDb } = require('./db');

const DEFAULT_MAX_RETRIES = 3;

function initSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      priority INTEGER DEFAULT 0,
      payload TEXT NOT NULL,
      result TEXT,
      retries INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 3,
      retry_after INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      dedupe_key TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_dedupe_key_active
      ON jobs(dedupe_key)
      WHERE dedupe_key IS NOT NULL AND status IN ('pending', 'active');

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
  `);

  // Migration: add retry_after column if missing (existing databases)
  try {
    db.prepare('SELECT retry_after FROM jobs LIMIT 1').get();
  } catch {
    db.exec('ALTER TABLE jobs ADD COLUMN retry_after INTEGER');
  }
}

// Initialise schema immediately on require
initSchema();

/**
 * Enqueue a job.
 * @param {string} type - Job type (e.g. 'download', 'upgrade', 'validate')
 * @param {object} payload - Arbitrary JSON-serialisable payload
 * @param {object} [opts]
 * @param {number} [opts.priority=0] - Higher value = higher priority
 * @param {number} [opts.maxRetries=3]
 * @param {string} [opts.dedupeKey] - If set, prevents duplicate active/pending jobs
 * @returns {number} Job ID (existing ID if deduplicated)
 */
function enqueue(type, payload, { priority = 0, maxRetries = DEFAULT_MAX_RETRIES, dedupeKey } = {}) {
  const db = getDb();

  // Check for existing pending/active job with the same dedupeKey
  if (dedupeKey != null) {
    const existing = db.prepare(
      "SELECT id FROM jobs WHERE dedupe_key = ? AND status IN ('pending', 'active')"
    ).get(dedupeKey);
    if (existing) return existing.id;
  }

  const result = db.prepare(`
    INSERT INTO jobs (type, status, priority, payload, max_retries, dedupe_key)
    VALUES (?, 'pending', ?, ?, ?, ?)
  `).run(type, priority, JSON.stringify(payload), maxRetries, dedupeKey || null);

  return result.lastInsertRowid;
}

/**
 * Dequeue the next pending job (atomically mark it active).
 * Picks highest priority first, then oldest (FIFO).
 * @param {string} [type] - Optional type filter
 * @returns {object|null} The job row, or null if none available
 */
function dequeue(type) {
  const db = getDb();

  const dequeueTransaction = db.transaction((type) => {
    const now = Date.now();
    let job;
    if (type) {
      job = db.prepare(
        "SELECT * FROM jobs WHERE status = 'pending' AND type = ? AND (retry_after IS NULL OR retry_after <= ?) ORDER BY priority DESC, id ASC LIMIT 1"
      ).get(type, now);
    } else {
      job = db.prepare(
        "SELECT * FROM jobs WHERE status = 'pending' AND (retry_after IS NULL OR retry_after <= ?) ORDER BY priority DESC, id ASC LIMIT 1"
      ).get(now);
    }

    if (!job) return null;

    db.prepare(
      "UPDATE jobs SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(job.id);

    return { ...job, status: 'active' };
  });

  return dequeueTransaction(type || null);
}

/**
 * Mark a job as done.
 * @param {number} id
 * @param {object} result - Result data to store as JSON
 */
function complete(id, result) {
  const db = getDb();
  db.prepare(
    "UPDATE jobs SET status = 'done', result = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(JSON.stringify(result), id);
}

/**
 * Mark a job as failed.
 * Increments retries. If retries < max_retries, resets to pending (will be retried).
 * If retries >= max_retries, sets to 'failed' (permanent failure).
 * @param {number} id
 * @param {string} error - Error message
 * @param {number} [retryAfter] - Timestamp (ms) before which the job should not be retried
 */
function fail(id, error, retryAfter) {
  const db = getDb();

  const failTransaction = db.transaction((id, error, retryAfter) => {
    const job = db.prepare('SELECT retries, max_retries FROM jobs WHERE id = ?').get(id);
    if (!job) return;

    const newRetries = job.retries + 1;
    const permanent = newRetries >= job.max_retries;
    const newStatus = permanent ? 'failed' : 'pending';
    const retryAfterVal = permanent ? null : (retryAfter || null);

    db.prepare(
      'UPDATE jobs SET status = ?, retries = ?, result = ?, retry_after = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(newStatus, newRetries, JSON.stringify({ error }), retryAfterVal, id);
  });

  failTransaction(id, error, retryAfter);
}

/**
 * Mark a job as skipped (no retry).
 * @param {number} id
 * @param {string} reason - 'skipped_duplicate' | 'skipped_no_upgrade'
 */
function skip(id, reason) {
  const db = getDb();
  db.prepare(`UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(reason, id);
}

/**
 * Get all jobs of a given type.
 * @param {string} type
 * @returns {object[]}
 */
function getByType(type) {
  const db = getDb();
  return db.prepare('SELECT * FROM jobs WHERE type = ? ORDER BY id ASC').all(type);
}

/**
 * Get all jobs with a given status.
 * @param {string} status - 'pending' | 'active' | 'done' | 'failed'
 * @returns {object[]}
 */
function getByStatus(status) {
  const db = getDb();
  return db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY id ASC').all(status);
}

/**
 * Get all jobs.
 * @returns {object[]}
 */
function getAll() {
  const db = getDb();
  return db.prepare('SELECT * FROM jobs ORDER BY id ASC').all();
}

function getStats() {
  const db = getDb();
  const rows = db.prepare('SELECT status, COUNT(*) as count FROM jobs GROUP BY status').all();
  const stats = { pending: 0, active: 0, done: 0, failed: 0 };
  for (const r of rows) {
    if (r.status in stats) stats[r.status] = r.count;
    else if (r.status.startsWith('skipped')) stats.done += r.count;
  }
  const oldest = db.prepare("SELECT MIN(created_at) as oldest FROM jobs WHERE status = 'pending'").get();
  stats.oldestPendingAge = oldest?.oldest ? Date.now() - new Date(oldest.oldest).getTime() : null;
  return stats;
}

module.exports = {
  enqueue,
  dequeue,
  complete,
  fail,
  skip,
  getByType,
  getByStatus,
  getAll,
  getStats,
};
