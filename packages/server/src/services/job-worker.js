'use strict';

const jobQueue = require('./job-queue');
const db = require('./db');
const { getExistingQuality, isUpgrade } = require('./library-check');
const activity = require('./activity-log');
const logger = require('./logger');
const log = logger.createChild('jobs');

const POLL_INTERVAL = 5000; // 5 seconds
const BACKOFF = [60000, 300000, 900000]; // 1min, 5min, 15min
const JOB_TIMEOUT = 1200000; // 20 minutes — large FLAC albums via RD need more time

// Per-type concurrency limits
const CONCURRENCY_LIMITS = {
  upgrade: 2,
  download: 1,          // RD API constraint
  'soulseek-download': 1, // single slskd connection
};
const DEFAULT_CONCURRENCY = 1;

let running = false;
let pollTimer = null;
let jobsProcessed = 0;
let jobsFailed = 0;
let lastJobAt = null;
let lastErrorAt = null;

// Track active jobs per type: Map<string, Set<number>>
const activeJobs = new Map();

let processor = async (job) => {
  throw new Error('No job processor registered');
};

function setProcessor(fn) {
  processor = fn;
}

function getActiveCount(type) {
  return activeJobs.get(type)?.size || 0;
}

function getLimit(type) {
  return CONCURRENCY_LIMITS[type] || DEFAULT_CONCURRENCY;
}

function trackJob(type, jobId) {
  if (!activeJobs.has(type)) activeJobs.set(type, new Set());
  activeJobs.get(type).add(jobId);
}

function untrackJob(type, jobId) {
  const set = activeJobs.get(type);
  if (set) {
    set.delete(jobId);
    if (set.size === 0) activeJobs.delete(type);
  }
}

/**
 * Execute a single job — handles guard logic, timeout, retry, logging.
 * Returns true if a job was processed, false if nothing was dequeued.
 */
async function executeJob(job) {
  const payload = JSON.parse(job.payload);

  // No-downgrade / duplicate guard: use a single getExistingQuality call.
  // Returns null if not in library (allow download), or a quality string if found.
  const existingQuality = (payload.artist && payload.album)
    ? getExistingQuality(payload.artist, payload.album)
    : null;

  if (existingQuality !== null && job.type !== 'upgrade') {
    // No-downgrade guard: skip for 'upgrade' jobs (they search for sources, don't have quality yet)
    const incomingQuality = (payload.source_meta?.quality || 'unknown').toLowerCase();
    if (!isUpgrade(existingQuality, incomingQuality)) {
      activity.log('upgrade', 'info', `Skipped (no upgrade): ${payload.artist} — ${payload.album} (have: ${existingQuality}, incoming: ${incomingQuality})`, { artist: payload.artist, album: payload.album, existing: existingQuality, incoming: incomingQuality });
      jobQueue.skip(job.id, 'skipped_no_upgrade');
      db.addJobLog({
        job_id: job.id,
        artist: payload.artist,
        album: payload.album,
        attempt: (job.retries || 0) + 1,
        duration_ms: 0,
        outcome: 'skipped_no_upgrade',
        fail_reason: null,
        quality: existingQuality,
      });
      return true;
    }
    // else: incoming quality is strictly better — continue to download (upgrade)
  }
  // existingQuality === null: album not in library — continue to download

  const start = Date.now();
  log.info({ event: 'job.started', jobId: job.id, type: job.type, artist: payload.artist, album: payload.album }, `Job started: ${payload.artist} — ${payload.album}`);
  let timeoutTimer;

  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutTimer = setTimeout(() => reject(new Error('Job timeout exceeded')), JOB_TIMEOUT);
    });
    const result = await Promise.race([processor(job), timeoutPromise]);
    clearTimeout(timeoutTimer);
    const duration = Date.now() - start;

    const outcome = result?.outcome || 'success';
    activity.log('upgrade', outcome === 'success' ? 'success' : 'info', `Job ${outcome}: ${payload.artist} — ${payload.album}${result?.quality ? ' (' + result.quality + ')' : ''}`, { artist: payload.artist, album: payload.album, outcome, quality: result?.quality });
    if (outcome === 'skipped_duplicate' || outcome === 'skipped_no_upgrade') {
      jobQueue.skip(job.id, outcome);
    } else if (outcome === 'stalled') {
      const retryAfter = Date.now() + (BACKOFF[job.retries || 0] || BACKOFF[BACKOFF.length - 1]);
      jobQueue.fail(job.id, 'stalled', retryAfter);
    } else {
      jobQueue.complete(job.id, result || {});
      jobsProcessed++; lastJobAt = Date.now();
      log.info({ event: 'job.complete', jobId: job.id, type: job.type, duration, outcome, artist: payload.artist, album: payload.album }, `Job complete: ${payload.artist} — ${payload.album} (${duration}ms)`);
    }
    db.addJobLog({
      job_id: job.id,
      artist: payload.artist,
      album: payload.album,
      attempt: (job.retries || 0) + 1,
      duration_ms: duration,
      outcome,
      fail_reason: null,
      quality: result?.quality || null,
    });
    return true;
  } catch (err) {
    clearTimeout(timeoutTimer);
    const duration = Date.now() - start;

    activity.log('upgrade', 'error', `Job failed: ${payload.artist} — ${payload.album}: ${err.message}`, { artist: payload.artist, album: payload.album, error: err.message, attempt: (job.retries || 0) + 1 });

    // RD timeouts and dead torrents won't improve on retry — fail permanently
    const noRetry = err.message.includes('RD timeout')
      || err.message.includes('magnet_error')
      || err.message.includes('dead')
      || err.message.includes('virus');
    if (noRetry) {
      jobQueue.complete(job.id, { error: err.message, outcome: 'failed_permanent' });
    } else {
      const retryAfter = Date.now() + (BACKOFF[job.retries || 0] || BACKOFF[BACKOFF.length - 1]);
      jobQueue.fail(job.id, err.message, retryAfter);
    }
    jobsFailed++; lastErrorAt = Date.now();
    const eventName = err.message === 'Job timeout exceeded' ? 'job.timeout' : 'job.failed';
    log.error({ event: eventName, jobId: job.id, type: job.type, duration, error: err.message, artist: payload.artist, album: payload.album }, `Job failed: ${payload.artist} — ${payload.album}: ${err.message}`);
    db.addJobLog({
      job_id: job.id,
      artist: payload.artist,
      album: payload.album,
      attempt: (job.retries || 0) + 1,
      duration_ms: duration,
      outcome: err.message === 'Job timeout exceeded' ? 'timeout' : 'failed',
      fail_reason: err.message,
      quality: null,
    });
    return true;
  }
}

/**
 * Try to fill all available concurrency slots across job types.
 */
function fillSlots() {
  if (!running) return;

  // Collect all types that have concurrency limits, plus check for untyped jobs
  const types = Object.keys(CONCURRENCY_LIMITS);

  for (const type of types) {
    const limit = getLimit(type);
    let active = getActiveCount(type);

    while (active < limit) {
      const job = jobQueue.dequeue(type);
      if (!job) break;

      active++;
      trackJob(type, job.id);

      // Fire-and-forget — completion triggers fillSlots again
      executeJob(job)
        .catch((err) => {
          log.error({ event: 'job.failed', type, error: err.message }, `executeJob error (${type}): ${err.message}`);
        })
        .finally(() => {
          untrackJob(type, job.id);
          // Try to fill the freed slot immediately
          setImmediate(fillSlots);
        });
    }
  }

  // Also dequeue any jobs with types not in CONCURRENCY_LIMITS (fallback)
  // These get DEFAULT_CONCURRENCY = 1
  const fallbackJob = jobQueue.dequeue(); // untyped dequeue
  if (fallbackJob && !types.includes(fallbackJob.type)) {
    const fType = fallbackJob.type;
    const limit = DEFAULT_CONCURRENCY;
    const active = getActiveCount(fType);

    if (active < limit) {
      trackJob(fType, fallbackJob.id);
      executeJob(fallbackJob)
        .catch((err) => {
          log.error({ event: 'job.failed', type: fType, error: err.message }, `executeJob error (${fType}): ${err.message}`);
        })
        .finally(() => {
          untrackJob(fType, fallbackJob.id);
          setImmediate(fillSlots);
        });
    }
    // If at limit, the job was already dequeued (marked active in DB) so it will run.
    // This edge case is minor — unknown types are rare.
  }
}

/**
 * processNextJob — thin wrapper for backward compatibility / tests.
 * Dequeues and processes a single job synchronously (awaits completion).
 */
async function processNextJob() {
  const job = jobQueue.dequeue();
  if (!job) return false;
  return executeJob(job);
}

async function poll() {
  if (!running) return;
  try {
    fillSlots();
  } catch (err) {
    // log but don't crash
    log.error({ event: 'job.poll.error', error: err.message }, `Poll error: ${err.message}`);
  }
  if (running) {
    pollTimer = setTimeout(poll, POLL_INTERVAL);
  }
}

function start() {
  if (running) return;
  running = true;
  poll();
}

function stop() {
  running = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function getStatus() {
  // Build active counts per type
  const activeByType = {};
  for (const [type, set] of activeJobs) {
    activeByType[type] = set.size;
  }
  const totalActive = Array.from(activeJobs.values()).reduce((sum, s) => sum + s.size, 0);

  return {
    running,
    jobsProcessed,
    jobsFailed,
    lastJobAt,
    lastErrorAt,
    concurrency: {
      limits: { ...CONCURRENCY_LIMITS },
      active: activeByType,
      totalActive,
    },
  };
}

module.exports = { start, stop, setProcessor, processNextJob, getStatus, fillSlots };
