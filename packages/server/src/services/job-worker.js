'use strict';

const jobQueue = require('./job-queue');
const db = require('./db');
const { getExistingQuality, isUpgrade } = require('./library-check');
const activity = require('./activity-log');

const POLL_INTERVAL = 5000; // 5 seconds
const BACKOFF = [60000, 300000, 900000]; // 1min, 5min, 15min
const JOB_TIMEOUT = 600000; // 10 minutes

let running = false;
let pollTimer = null;
let jobsProcessed = 0;
let jobsFailed = 0;
let lastJobAt = null;
let lastErrorAt = null;

let processor = async (job) => {
  throw new Error('No job processor registered');
};

function setProcessor(fn) {
  processor = fn;
}

async function processNextJob() {
  const job = jobQueue.dequeue();
  if (!job) return false;

  const payload = JSON.parse(job.payload);

  // No-downgrade / duplicate guard: use a single getExistingQuality call.
  // Returns null if not in library (allow download), or a quality string if found.
  const existingQuality = (payload.artist && payload.album)
    ? getExistingQuality(payload.artist, payload.album)
    : null;

  if (existingQuality !== null) {
    // Album exists on disk — only proceed if incoming quality is strictly better
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
    const retryAfter = Date.now() + (BACKOFF[job.retries || 0] || BACKOFF[BACKOFF.length - 1]);
    jobQueue.fail(job.id, err.message, retryAfter);
    jobsFailed++; lastErrorAt = Date.now();
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

async function poll() {
  if (!running) return;
  try {
    await processNextJob();
  } catch (err) {
    // log but don't crash
    console.error('[job-worker] poll error:', err.message);
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
  return { running, jobsProcessed, jobsFailed, lastJobAt, lastErrorAt };
}

module.exports = { start, stop, setProcessor, processNextJob, getStatus };
