'use strict';

const jobQueue = require('./job-queue');
const db = require('./db');

const POLL_INTERVAL = 5000; // 5 seconds
const BACKOFF = [60000, 300000, 900000]; // 1min, 5min, 15min
const JOB_TIMEOUT = 600000; // 10 minutes

let running = false;
let pollTimer = null;

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
  const start = Date.now();
  let timeoutTimer;

  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutTimer = setTimeout(() => reject(new Error('Job timeout exceeded')), JOB_TIMEOUT);
    });
    const result = await Promise.race([processor(job), timeoutPromise]);
    clearTimeout(timeoutTimer);
    const duration = Date.now() - start;

    jobQueue.complete(job.id, result || {});
    db.addJobLog({
      job_id: job.id,
      artist: payload.artist,
      album: payload.album,
      attempt: (job.retries || 0) + 1,
      duration_ms: duration,
      outcome: 'success',
      fail_reason: null,
      quality: result?.quality || null,
    });
    return true;
  } catch (err) {
    clearTimeout(timeoutTimer);
    const duration = Date.now() - start;

    const retryAfter = Date.now() + (BACKOFF[job.retries || 0] || BACKOFF[BACKOFF.length - 1]);
    jobQueue.fail(job.id, err.message, retryAfter);
    db.addJobLog({
      job_id: job.id,
      artist: payload.artist,
      album: payload.album,
      attempt: (job.retries || 0) + 1,
      duration_ms: duration,
      outcome: duration >= JOB_TIMEOUT ? 'timeout' : 'failed',
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

module.exports = { start, stop, setProcessor, processNextJob };
