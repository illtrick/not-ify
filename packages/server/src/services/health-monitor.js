'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const logger = require('./logger');

const log = logger.createChild('health');

const CONFIG_DIR = process.env.CONFIG_DIR || '/app/config';
const MUSIC_DIR = process.env.MUSIC_DIR || '/app/music';

const LAG_CHECK_INTERVAL = 1000;    // 1s
const HEALTH_CHECK_INTERVAL = 60000; // 60s
const LAG_WARN = 50;   // ms
const LAG_ERROR = 200;  // ms
const LAG_FATAL = 2000; // ms

let lagTimer = null;
let healthTimer = null;
let lastLagCheck = null;

// --- Event Loop Lag Detector ---

function startLagDetector() {
  lastLagCheck = performance.now();
  lagTimer = setInterval(() => {
    const now = performance.now();
    const expected = LAG_CHECK_INTERVAL;
    const actual = now - lastLagCheck;
    const lag = Math.round(actual - expected);
    lastLagCheck = now;

    if (lag > LAG_WARN) {
      const mem = process.memoryUsage();
      const meta = { lag, heapUsed: mem.heapUsed, rss: mem.rss, external: mem.external };

      if (lag > LAG_FATAL) {
        log.fatal({ event: 'health.eventloop.lag', ...meta }, `Event loop blocked ${lag}ms`);
      } else if (lag > LAG_ERROR) {
        log.error({ event: 'health.eventloop.lag', ...meta }, `Event loop lag ${lag}ms`);
      } else {
        log.warn({ event: 'health.eventloop.lag', ...meta }, `Event loop lag ${lag}ms`);
      }
    }
  }, LAG_CHECK_INTERVAL);

  // Unref so the timer doesn't prevent graceful exit
  if (lagTimer.unref) lagTimer.unref();
}

// --- Periodic Health Snapshot ---

function getSnapshot(extras = {}) {
  const mem = process.memoryUsage();
  return {
    memory: {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      rss: mem.rss,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
    },
    uptime: Math.round(process.uptime()),
    activeHandles: process._getActiveHandles?.()?.length ?? -1,
    activeRequests: process._getActiveRequests?.()?.length ?? -1,
    ...extras,
  };
}

function startHealthSnapshots(getExtras) {
  healthTimer = setInterval(() => {
    const extras = typeof getExtras === 'function' ? getExtras() : {};
    const snapshot = getSnapshot(extras);
    log.info({ event: 'health.check', ...snapshot }, 'Health snapshot');
  }, HEALTH_CHECK_INTERVAL);

  if (healthTimer.unref) healthTimer.unref();
}

// --- Startup Baseline Benchmark ---

async function runStartupBenchmark(dbService) {
  const result = {
    env: process.env.NODE_ENV || 'development',
    nodeVersion: process.version,
    platform: os.platform(),
    arch: os.arch(),
    cpuModel: os.cpus()[0]?.model || 'unknown',
    cpuCount: os.cpus().length,
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    sqliteBenchmark: -1,
    fsBenchmark: -1,
  };

  // SQLite benchmark: SELECT 1
  try {
    if (dbService && typeof dbService.benchmark === 'function') {
      const dbResult = dbService.benchmark();
      result.sqliteBenchmark = dbResult.duration;
    }
  } catch (err) {
    log.warn({ event: 'health.benchmark.sqlite.error', error: err.message }, 'SQLite benchmark failed');
  }

  // FS benchmark: write + read temp file in MUSIC_DIR (or CONFIG_DIR fallback)
  try {
    const benchDir = fs.existsSync(MUSIC_DIR) ? MUSIC_DIR : CONFIG_DIR;
    const tmpFile = path.join(benchDir, `.bench-${Date.now()}.tmp`);
    const data = Buffer.alloc(1024 * 1024, 'x'); // 1MB

    const fsStart = performance.now();
    fs.writeFileSync(tmpFile, data);
    fs.readFileSync(tmpFile);
    fs.unlinkSync(tmpFile);
    result.fsBenchmark = Math.round(performance.now() - fsStart);
  } catch (err) {
    log.warn({ event: 'health.benchmark.fs.error', error: err.message }, 'FS benchmark failed');
  }

  log.info({ event: 'server.ready', ...result }, 'Startup benchmark complete');
  return result;
}

// --- Start / Stop ---

function start(getExtras) {
  startLagDetector();
  startHealthSnapshots(getExtras);
}

function stop() {
  if (lagTimer) { clearInterval(lagTimer); lagTimer = null; }
  if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
}

module.exports = { start, stop, getSnapshot, runStartupBenchmark };
