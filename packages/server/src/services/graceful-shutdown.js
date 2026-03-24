'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const log = logger.createChild('shutdown');
const CONFIG_DIR = process.env.CONFIG_DIR || '/app/config';
const FLAG_FILE = path.join(CONFIG_DIR, '.clean-shutdown');
const FORCE_KILL_TIMEOUT = 15000; // 15s

let services = {};
let shutdownInProgress = false;
let healthStatus = 'ok';

function register(opts) {
  services = { ...opts };
}

function getHealthStatus() {
  return healthStatus;
}

function checkStartupRecovery({ resetStuckJobs }) {
  const wasClean = fs.existsSync(FLAG_FILE);

  if (wasClean) {
    try { fs.unlinkSync(FLAG_FILE); } catch {}
    log.info({ event: 'server.startup.clean' }, 'Previous shutdown was clean');
    return { cleanShutdown: true, recoveredJobs: 0 };
  }

  log.warn({ event: 'server.startup.unclean' }, 'Previous shutdown was not clean — recovering stuck jobs');
  let recoveredJobs = 0;
  try {
    recoveredJobs = resetStuckJobs();
    if (recoveredJobs > 0) {
      log.warn(
        { event: 'job.recovered.on.startup', count: recoveredJobs },
        `Recovered ${recoveredJobs} stuck job(s) from unclean shutdown`,
      );
    }
  } catch (err) {
    log.error({ event: 'server.startup.recovery.error', error: err.message }, 'Job recovery failed');
  }

  return { cleanShutdown: false, recoveredJobs };
}

async function executeShutdown() {
  if (shutdownInProgress) return;
  shutdownInProgress = true;

  log.info({ event: 'server.shutdown.started' }, 'Shutdown initiated');

  const forceTimer = setTimeout(() => {
    log.fatal({ event: 'server.shutdown.forced' }, 'Shutdown timed out — forcing exit');
    process.exit(1);
  }, FORCE_KILL_TIMEOUT);
  if (forceTimer.unref) forceTimer.unref();

  try {
    // 1. Stop accepting new connections
    if (services.httpServer) {
      await new Promise((resolve) => {
        services.httpServer.close((err) => {
          if (err) log.warn({ error: err.message }, 'HTTP server close error');
          resolve();
        });
      });
    }

    // 2. Set health to 503
    healthStatus = 'shutting-down';

    // 3. End SSE connections
    if (services.sseConnections) {
      for (const res of services.sseConnections) {
        try { res.end(); } catch {}
      }
      services.sseConnections.clear();
    }

    // 4. Stop job worker
    if (services.jobWorker && typeof services.jobWorker.stop === 'function') {
      services.jobWorker.stop();
    }

    // 5. Stop upgrader interval
    if (services.upgraderInterval) {
      clearInterval(services.upgraderInterval);
    }

    // 6. Stop scrobble sync
    if (services.scrobbleSync && typeof services.scrobbleSync.stopAll === 'function') {
      services.scrobbleSync.stopAll();
    }

    // 7. Stop DLNA discovery
    if (services.dlna && typeof services.dlna.stopDiscovery === 'function') {
      try { services.dlna.stopDiscovery(); } catch {}
    }

    // 8. Flush Last.fm scrobble queue (5s timeout)
    if (typeof services.flushScrobbles === 'function') {
      try {
        await Promise.race([
          services.flushScrobbles(),
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]);
      } catch (err) {
        log.warn({ error: err.message }, 'Scrobble flush failed');
      }
    }

    // 9. Mark active jobs as interrupted
    if (typeof services.resetActiveJobs === 'function') {
      try { services.resetActiveJobs(); } catch {}
    }

    // 10. SQLite maintenance
    if (services.db) {
      try { services.db.checkpoint(); } catch (err) {
        log.warn({ error: err.message }, 'WAL checkpoint failed');
      }
      try { services.db.optimize(); } catch (err) {
        log.warn({ error: err.message }, 'PRAGMA optimize failed');
      }
      try { services.db.close(); } catch (err) {
        log.warn({ error: err.message }, 'DB close failed');
      }
    }

    // 11. Write clean shutdown flag
    try { fs.writeFileSync(FLAG_FILE, String(Date.now())); } catch {}

    // 12. Flush logs
    try { await logger.flushAndClose(); } catch {}

    log.info({ event: 'server.shutdown.complete' }, 'Shutdown complete');
  } finally {
    clearTimeout(forceTimer);
  }
}

function installSignalHandlers() {
  const handler = (signal) => {
    log.info({ event: 'server.signal', signal }, `Received ${signal}`);
    executeShutdown().then(() => process.exit(0)).catch(() => process.exit(1));
  };
  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);
}

module.exports = { register, checkStartupRecovery, executeShutdown, installSignalHandlers, getHealthStatus };
