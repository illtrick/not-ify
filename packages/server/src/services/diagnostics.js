'use strict';

const path = require('path');
const fs = require('fs');
const pkg = require('../../../../package.json');

const services = {
  activityLog: () => require('./activity-log').getStatus(),
  jobWorker: () => require('./job-worker').getStatus(),
  jobQueue: () => require('./job-queue').getStats(),
  llm: () => require('./llm').getStatus(),
  youtube: () => require('./youtube').getStatus(),
  dlna: () => require('./dlna').getStatus(),
  fileValidator: () => require('./file-validator').getStatus(),
  scrobbleSync: () => require('./scrobble-sync').getStatus(),
  castSession: () => require('./cast-session').getStatus(),
  realdebrid: () => require('./realdebrid').getStatus(),
  downloader: () => require('./downloader').getStatus(),
  soulseek: () => require('./soulseek').getStatus(),
};

let _upgraderGetter = null;

function registerUpgrader(getter) {
  _upgraderGetter = getter;
}

async function collect() {
  const result = {
    version: pkg.version,
    serverUptime: process.uptime(),
    timestamp: new Date().toISOString(),
    platform: process.platform,
    nodeVersion: process.version,
    services: {},
  };

  for (const [name, getter] of Object.entries(services)) {
    try {
      result.services[name] = getter();
    } catch (err) {
      result.services[name] = { error: err.message };
    }
  }

  if (_upgraderGetter) {
    try {
      const upgrader = _upgraderGetter();
      result.services.upgrader = { idle: upgrader ? upgrader.isIdle() : null };
    } catch (err) {
      result.services.upgrader = { error: err.message };
    }
  }

  // VPN status from gluetun control API
  try {
    const controlUrl = process.env.GLUETUN_CONTROL_URL;
    if (controlUrl) {
      const r = await fetch(`${controlUrl}/v1/publicip/ip`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) {
        const data = await r.json();
        result.services.vpn = { connected: true, ip: data.public_ip, provider: process.env.VPN_PROVIDER || 'unknown' };
      } else {
        result.services.vpn = { connected: false, provider: process.env.VPN_PROVIDER || 'unknown' };
      }
    }
  } catch {
    result.services.vpn = { connected: false, error: 'gluetun unreachable' };
  }

  try {
    const dbPath = path.join(process.env.CONFIG_DIR || '/app/config', 'notify.db');
    if (fs.existsSync(dbPath)) {
      const stat = fs.statSync(dbPath);
      result.services.db = { sizeBytes: stat.size, sizeMB: +(stat.size / 1024 / 1024).toFixed(1) };
    }
  } catch (err) {
    result.services.db = { error: err.message };
  }

  try {
    const activityLog = require('./activity-log');
    const errors = activityLog.getEntries({ limit: 200 })
      .filter(e => e.level === 'error')
      .slice(-10)
      .map(e => ({ ts: e.ts, category: e.category, message: e.message }));
    result.recentErrors = errors;
  } catch {
    result.recentErrors = [];
  }

  return result;
}

module.exports = { collect, registerUpgrader };
