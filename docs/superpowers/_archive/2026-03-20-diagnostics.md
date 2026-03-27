# Diagnostics & Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-click diagnostic export bundling all server service state + client app state into a pasteable text blob for debugging.

**Architecture:** Server services each get a `getStatus()` getter. A `diagnostics.js` aggregator calls them all with per-service error handling. Client collector logs API calls and errors passively, assembles snapshot on demand. Status tab in ActivityLog renders internal state + "Copy Diagnostics" button.

**Tech Stack:** Express, SQLite, React, existing api-client.js fetch wrapper

**Spec:** `docs/superpowers/specs/2026-03-20-diagnostics-design.md`

---

### Task 1: Add `getStatus()` to activity-log.js

**Files:**
- Modify: `packages/server/src/services/activity-log.js`

- [ ] **Step 1: Add error tracking + getStatus**

Add module-scoped counters and a `getStatus()` export:

```javascript
// Add after line 11 (const entries = [];)
let errorCount = 0;
let lastError = null;
const bootTime = Date.now();
```

In the `log()` function, after `entries.push(entry)` (line 26), add:

```javascript
  if (level === 'error') {
    errorCount++;
    lastError = entry;
  }
```

Add before `module.exports`:

```javascript
function getStatus() {
  return {
    entryCount: entries.length,
    errorCount,
    lastError: lastError ? { ts: lastError.ts, category: lastError.category, message: lastError.message } : null,
    uptimeMs: Date.now() - bootTime,
  };
}
```

Export `getStatus` alongside existing exports.

- [ ] **Step 2: Verify server starts**

Run: `cd packages/server && node -e "const a = require('./src/services/activity-log'); console.log(a.getStatus())"`
Expected: `{ entryCount: 0, errorCount: 0, lastError: null, uptimeMs: ... }`

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/services/activity-log.js
git commit -m "feat(diagnostics): add getStatus to activity-log"
```

---

### Task 2: Add `getStatus()` to job-worker.js and job-queue.js

**Files:**
- Modify: `packages/server/src/services/job-worker.js`
- Modify: `packages/server/src/services/job-queue.js`

- [ ] **Step 1: Add counters to job-worker.js**

Add module-scoped tracking after `let pollTimer = null;` (line 13):

```javascript
let jobsProcessed = 0;
let jobsFailed = 0;
let lastJobAt = null;
let lastErrorAt = null;
```

In `processNextJob()`, after a successful job completion, increment `jobsProcessed++; lastJobAt = Date.now();`. After a failed job, increment `jobsFailed++; lastErrorAt = Date.now();`. Look for where `jobQueue.complete()` and `jobQueue.fail()` are called and add the counter updates right after.

Add getter:

```javascript
function getStatus() {
  return { running, jobsProcessed, jobsFailed, lastJobAt, lastErrorAt };
}
```

Export `getStatus` alongside existing exports.

- [ ] **Step 2: Add getStats to job-queue.js**

Add using the existing `getDb` import at top of file (line 3: `const { getDb } = require('./db')`):

```javascript
function getStats() {
  const db = getDb();
  const rows = db.prepare(`SELECT status, COUNT(*) as count FROM jobs GROUP BY status`).all();
  const stats = { pending: 0, active: 0, done: 0, failed: 0 };
  for (const r of rows) {
    if (r.status in stats) stats[r.status] = r.count;
    else if (r.status.startsWith('skipped')) stats.done += r.count;
  }
  // Oldest pending job age
  const oldest = db.prepare(`SELECT MIN(created_at) as oldest FROM jobs WHERE status = 'pending'`).get();
  stats.oldestPendingAge = oldest?.oldest ? Date.now() - new Date(oldest.oldest).getTime() : null;
  return stats;
}
```

Export `getStats` alongside existing exports.

- [ ] **Step 3: Verify both**

Run: `cd packages/server && node -e "const w = require('./src/services/job-worker'); console.log(w.getStatus())"`
Expected: `{ running: false, jobsProcessed: 0, jobsFailed: 0, lastJobAt: null, lastErrorAt: null }`

Run: `cd packages/server && node -e "const q = require('./src/services/job-queue'); console.log(q.getStats())"`
Expected: `{ pending: 0, active: 0, done: 0, failed: 0, oldestPendingAge: null }` (or real counts if DB has data)

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/job-worker.js packages/server/src/services/job-queue.js
git commit -m "feat(diagnostics): add getStatus to job-worker, getStats to job-queue"
```

---

### Task 3: Add `getStatus()` to llm.js, youtube.js, dlna.js

**Files:**
- Modify: `packages/server/src/services/llm.js`
- Modify: `packages/server/src/services/youtube.js`
- Modify: `packages/server/src/services/dlna.js`

- [ ] **Step 1: llm.js getStatus**

Add before `module.exports`:

```javascript
function getStatus() {
  return {
    healthy,
    modelReady,
    lastCheckAt: lastHealthCheck || null,
    cacheSize: Object.keys(diskCache).length,
    ollamaUrl: OLLAMA_URL,
    model: MODEL,
  };
}
```

Export `getStatus`.

- [ ] **Step 2: youtube.js getStatus**

Add before `module.exports`:

```javascript
function getStatus() {
  return {
    activeProcesses,
    maxConcurrent: MAX_CONCURRENT,
    searchCacheSize: searchCache.size,
    urlCacheSize: urlCache.size,
  };
}
```

Export `getStatus`.

- [ ] **Step 3: dlna.js getStatus**

Add a module-scoped `let lastScanAt = null;` near the other module vars. In `_sendSearch()` (line 132), add `lastScanAt = Date.now();` at the top.

Add the getter:

```javascript
function getStatus() {
  const devices = [];
  for (const [usn, d] of _devices) {
    devices.push({ name: d.displayName || d.friendlyName, type: d.deviceType, ip: d.ip });
  }
  return {
    enabled: !!process.env.DLNA_ENABLED,
    deviceCount: _devices.size,
    devices,
    scanning: !!_socket,
    lastScanAt,
  };
}
```

Export `getStatus`.

- [ ] **Step 4: Verify**

Run: `cd packages/server && node -e "const l = require('./src/services/llm'); console.log(l.getStatus())"`
Run: `cd packages/server && node -e "const y = require('./src/services/youtube'); console.log(y.getStatus())"`

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/llm.js packages/server/src/services/youtube.js packages/server/src/services/dlna.js
git commit -m "feat(diagnostics): add getStatus to llm, youtube, dlna"
```

---

### Task 4: Add `getStatus()` to file-validator, scrobble-sync, cast-session, realdebrid, downloader

**Files:**
- Modify: `packages/server/src/services/file-validator.js`
- Modify: `packages/server/src/services/scrobble-sync.js`
- Modify: `packages/server/src/services/cast-session.js`
- Modify: `packages/server/src/services/realdebrid.js`
- Modify: `packages/server/src/services/downloader.js`

- [ ] **Step 1: file-validator.js**

Add module-scoped cache for tool availability (lazy — populated after first `validateFile()` call):

```javascript
let _toolStatus = null; // { file: bool, ffprobe: bool, clamdscan: bool }
```

At the end of `validateFile()`, before returning, cache tool availability from the checks array. Note: the check names in the `checks` array are `'mime'`, `'ffprobe'`, and `'clam'`. A check with `skipped: true` means the tool is unavailable. A missing check entry means it was conditionally disabled (e.g., MIME check disabled via env var).

```javascript
  const mimeCheck = checks.find(c => c.name === 'mime');
  const ffprobeCheck = checks.find(c => c.name === 'ffprobe');
  const clamCheck = checks.find(c => c.name === 'clam');
  _toolStatus = {
    file: mimeCheck ? !mimeCheck.skipped : null,      // null = check disabled, true = available, false = missing
    ffprobe: ffprobeCheck ? !ffprobeCheck.skipped : null,
    clamdscan: clamCheck ? !clamCheck.skipped : null,
  };
```

Add getter:

```javascript
function getStatus() {
  return {
    toolsProbed: _toolStatus !== null,
    tools: _toolStatus || { file: 'untested', ffprobe: 'untested', clamdscan: 'untested' },
  };
}
```

Export `getStatus`.

- [ ] **Step 2: scrobble-sync.js**

Add getter using existing `getSyncState`:

```javascript
function getStatus() {
  const db = require('./db');
  const users = db.getUsers();
  const syncs = {};
  for (const u of users) {
    const state = getSyncState(u.id);
    syncs[u.display_name || u.id] = {
      state: state.state || 'idle',
      lastSyncedAt: state.lastSyncedAt || null,
      total: state.total || 0,
      fetched: state.fetched || 0,
      error: state.error || null,
      scheduled: intervals.has(u.id),
    };
  }
  return syncs;
}
```

Export `getStatus`.

- [ ] **Step 3: cast-session.js**

Add getter:

```javascript
function getStatus() {
  const sessions = [];
  for (const [userId, s] of _sessions) {
    sessions.push({
      userId,
      deviceUsn: s.deviceUsn,
      deviceType: s.deviceType,
      queueLength: s.queue?.length || 0,
      queueIndex: s.queueIndex,
    });
  }
  return { activeSessions: sessions.length, sessions };
}
```

Export `getStatus`.

- [ ] **Step 4: realdebrid.js**

Add module-scoped tracking:

```javascript
let lastCallAt = null;
let lastCallOk = null;
let lastError = null;
```

In `rdFetch()`, after a successful response: `lastCallAt = Date.now(); lastCallOk = true;`
In the error path: `lastCallAt = Date.now(); lastCallOk = false; lastError = err.message;`

Wrap the core of `rdFetch()` in a try/finally to track call outcomes. After `const res = await proxyFetch(...)` succeeds (line ~47), set `lastCallAt = Date.now(); lastCallOk = true;`. In the `if (!res.ok)` branch (line ~50), before throwing, set `lastCallOk = false; lastError = body;`. Also add a catch block for network errors: `lastCallAt = Date.now(); lastCallOk = false; lastError = err.message;`.

Add getter:

```javascript
function getStatus() {
  return {
    configured: !!(_cachedToken || process.env.RD_TOKEN),
    lastCallAt,
    lastCallOk,
    lastError,
  };
}
```

Export `getStatus`. Uses `_cachedToken` and env var only — no file I/O on status check.

- [ ] **Step 5: downloader.js**

Add module-scoped tracking:

```javascript
let activeDownloads = 0;
let lastCompletedAt = null;
let lastFailedAt = null;
let lastError = null;
```

In `downloadFile()`: increment `activeDownloads++` at start, `activeDownloads--` in finally block. On success: `lastCompletedAt = Date.now()`. On error: `lastFailedAt = Date.now(); lastError = err.message;`.

In `downloadAlbum()`: same pattern.

Add getter:

```javascript
function getStatus() {
  return { activeDownloads, lastCompletedAt, lastFailedAt, lastError };
}
```

Export `getStatus`.

- [ ] **Step 6: Verify**

Run: `cd packages/server && node -e "const f = require('./src/services/file-validator'); console.log(f.getStatus())"`
Expected: `{ toolsProbed: false, tools: { file: 'untested', ffprobe: 'untested', clamdscan: 'untested' } }`

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/file-validator.js packages/server/src/services/scrobble-sync.js packages/server/src/services/cast-session.js packages/server/src/services/realdebrid.js packages/server/src/services/downloader.js
git commit -m "feat(diagnostics): add getStatus to file-validator, scrobble-sync, cast-session, realdebrid, downloader"
```

---

### Task 5: Create diagnostics.js aggregator and /api/diagnostics endpoint

**Files:**
- Create: `packages/server/src/services/diagnostics.js`
- Modify: `packages/server/src/index.js`

- [ ] **Step 1: Create diagnostics.js**

```javascript
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
};

// Quality upgrader is a class instance — must be registered after init
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

  // Collect from all registered services
  for (const [name, getter] of Object.entries(services)) {
    try {
      result.services[name] = getter();
    } catch (err) {
      result.services[name] = { error: err.message };
    }
  }

  // Quality upgrader (class instance, needs special handling)
  if (_upgraderGetter) {
    try {
      const upgrader = _upgraderGetter();
      result.services.upgrader = {
        idle: upgrader ? upgrader.isIdle() : null,
      };
    } catch (err) {
      result.services.upgrader = { error: err.message };
    }
  }

  // DB file size
  try {
    const dbPath = path.join(process.env.CONFIG_DIR || '/app/config', 'notify.db');
    if (fs.existsSync(dbPath)) {
      const stat = fs.statSync(dbPath);
      result.services.db = { sizeBytes: stat.size, sizeMB: +(stat.size / 1024 / 1024).toFixed(1) };
    }
  } catch (err) {
    result.services.db = { error: err.message };
  }

  // Recent errors from activity log
  try {
    const activityLog = require('./activity-log');
    const errors = activityLog.getEntries({ category: undefined, limit: 200 })
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
```

- [ ] **Step 2: Add /api/diagnostics to index.js**

After the existing `/api/health/services` endpoint, add:

```javascript
const diagnostics = require('./services/diagnostics');

app.get('/api/diagnostics', adminGuard, async (req, res) => {
  try {
    const data = await diagnostics.collect();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

Also, inside the `app.listen()` callback (around line 562 of index.js, where services are started), register the upgrader:

```javascript
diagnostics.registerUpgrader(() => {
  try { return upgradeRouter.getUpgrader(); } catch { return null; }
});
```

This must be inside the `app.listen` callback because the upgrader is lazily initialized there.

- [ ] **Step 3: Verify**

Run: `cd packages/server && node -e "const d = require('./src/services/diagnostics'); d.collect().then(r => console.log(JSON.stringify(r, null, 2)))"`
Expected: JSON with version, serverUptime, services object with all service statuses.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/diagnostics.js packages/server/src/index.js
git commit -m "feat(diagnostics): add diagnostics aggregator and /api/diagnostics endpoint"
```

---

### Task 6: Add getDiagnostics + onRequest hook to api-client.js

**Files:**
- Modify: `packages/shared/src/api-client.js`

- [ ] **Step 1: Add onRequest callback to configure()**

At the top, add a module-scoped callback:

```javascript
let _onRequest = null;
```

In `configure()` (line 18), add:

```javascript
export function configure({ baseUrl, onVersionMismatch, onRequest }) {
  _baseUrl = (baseUrl || '').replace(/\/$/, '');
  if (onVersionMismatch) _versionMismatchCallback = onVersionMismatch;
  if (onRequest) _onRequest = onRequest;
}
```

In `request()` (line 61), wrap the fetch call to report timing:

```javascript
export async function request(path, options = {}) {
  const url = `${_baseUrl}${path}`;
  const headers = { ...options.headers };
  if (_userId) headers['X-User-Id'] = _userId;

  const startTime = Date.now();
  let response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch (err) {
    if (_onRequest) _onRequest({ path, method: options.method || 'GET', error: err.message, latency: Date.now() - startTime });
    throw err;
  }

  const latency = Date.now() - startTime;
  if (_onRequest) _onRequest({ path, method: options.method || 'GET', status: response.status, latency });

  if (!response.ok) {
    const error = new Error(`API ${response.status}: ${response.statusText}`);
    error.status = response.status;
    try { error.body = await response.json(); } catch {}
    throw error;
  }

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json();
  }
  return response;
}
```

- [ ] **Step 2: Add getDiagnostics export**

Add near the other health/activity exports at the bottom:

```javascript
export function getDiagnostics() {
  return get('/api/diagnostics');
}
```

- [ ] **Step 3: Verify no build errors**

Run: `cd packages/client && npm run build`

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/api-client.js
git commit -m "feat(diagnostics): add getDiagnostics + onRequest hook to api-client"
```

---

### Task 7: Create client-diagnostics.js collector

**Files:**
- Create: `packages/client/src/services/client-diagnostics.js`

- [ ] **Step 1: Create the collector module**

```javascript
/**
 * Client-side diagnostics collector.
 * Passively logs API calls and errors. Assembles snapshot on demand.
 */

import * as api from '@not-ify/shared';

const MAX_CALLS = 20;
const MAX_ERRORS = 50;

const _apiCalls = [];
const _errors = [];
const _bootTime = Date.now();

// --- SSE connection tracking ---
const _sseConnections = {}; // { name: { open: bool, lastEventAt: number|null, reconnectCount: number } }

/** Call when an SSE connection opens or reconnects */
export function trackSseOpen(name) {
  if (!_sseConnections[name]) _sseConnections[name] = { open: false, lastEventAt: null, reconnectCount: 0 };
  if (_sseConnections[name].open) _sseConnections[name].reconnectCount++;
  _sseConnections[name].open = true;
}

/** Call when an SSE connection closes */
export function trackSseClose(name) {
  if (_sseConnections[name]) _sseConnections[name].open = false;
}

/** Call when an SSE event is received */
export function trackSseEvent(name) {
  if (!_sseConnections[name]) _sseConnections[name] = { open: true, lastEventAt: null, reconnectCount: 0 };
  _sseConnections[name].lastEventAt = Date.now();
}

// --- Passive collectors ---

/** Register as onRequest callback in api-client configure() */
export function onApiRequest({ path, method, status, latency, error }) {
  // Strip query params to avoid leaking tokens
  const cleanPath = path.split('?')[0];
  _apiCalls.push({ path: cleanPath, method, status, latency, error, ts: Date.now() });
  if (_apiCalls.length > MAX_CALLS) _apiCalls.shift();
}

/** Call once on app init to start capturing uncaught errors */
export function startErrorCapture() {
  window.addEventListener('error', (e) => {
    _errors.push({ ts: Date.now(), message: e.message, source: e.filename, line: e.lineno });
    if (_errors.length > MAX_ERRORS) _errors.shift();
  });
  window.addEventListener('unhandledrejection', (e) => {
    _errors.push({ ts: Date.now(), message: e.reason?.message || String(e.reason), type: 'unhandledrejection' });
    if (_errors.length > MAX_ERRORS) _errors.shift();
  });
}

// --- Snapshot assembly ---

function formatDuration(ms) {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h${Math.floor((ms % 3600000) / 60000)}m`;
}

function formatTs(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Assemble full diagnostic text.
 * @param {Object} serverData - response from GET /api/diagnostics
 * @param {Object} appState - from window.__notifyDiagnostics()
 */
export function formatDiagnostics(serverData, appState) {
  const lines = [];
  const v = serverData.version || '?';
  lines.push(`=== NOT-IFY DIAGNOSTICS v${v} ===`);
  lines.push(`Timestamp: ${serverData.timestamp || new Date().toISOString()}`);
  lines.push(`Uptime: server ${formatDuration((serverData.serverUptime || 0) * 1000)}, client ${formatDuration(Date.now() - _bootTime)}`);
  lines.push('');

  // --- Server services ---
  lines.push('--- SERVER SERVICES ---');
  const s = serverData.services || {};

  if (s.jobWorker) {
    const w = s.jobWorker;
    const lastJob = w.lastJobAt ? `${formatDuration(Date.now() - w.lastJobAt)} ago` : 'never';
    lines.push(`upgrader: ${w.running ? 'running' : 'idle'} | last job: ${lastJob} | processed: ${w.jobsProcessed} | failed: ${w.jobsFailed}`);
  }
  if (s.jobQueue) {
    const q = s.jobQueue;
    lines.push(`job-queue: ${q.pending} pending, ${q.active} active, ${q.done} done, ${q.failed} failed`);
  }
  if (s.llm) {
    const l = s.llm;
    lines.push(`llm: ${l.healthy === true ? 'healthy' : l.healthy === false ? 'unhealthy' : 'unknown'} | model: ${l.modelReady ? 'ready' : 'not ready'} | cache: ${l.cacheSize} entries`);
  }
  if (s.youtube) {
    const y = s.youtube;
    lines.push(`youtube: ${y.activeProcesses}/${y.maxConcurrent} active | search cache: ${y.searchCacheSize} | url cache: ${y.urlCacheSize}`);
  }
  if (s.dlna) {
    const d = s.dlna;
    const scan = d.lastScanAt ? `${formatDuration(Date.now() - d.lastScanAt)} ago` : 'never';
    const devNames = d.devices?.map(x => x.name).join(', ') || 'none';
    lines.push(`dlna: ${d.deviceCount} devices (${devNames}) | last scan: ${scan}`);
  }
  if (s.fileValidator) {
    const f = s.fileValidator;
    const t = f.tools;
    const fmt = (v) => v === true ? 'ok' : v === false ? 'missing' : 'untested';
    lines.push(`file-validator: file ${fmt(t.file)} | ffprobe ${fmt(t.ffprobe)} | clamdscan ${fmt(t.clamdscan)}`);
  }
  if (s.realdebrid) {
    const r = s.realdebrid;
    const last = r.lastCallAt ? `${formatDuration(Date.now() - r.lastCallAt)} ago (${r.lastCallOk ? 'ok' : 'failed'})` : 'no calls';
    lines.push(`realdebrid: ${r.configured ? 'configured' : 'not configured'} | last call: ${last}`);
  }
  if (s.downloader) {
    const d = s.downloader;
    const last = d.lastCompletedAt ? `${formatDuration(Date.now() - d.lastCompletedAt)} ago` : 'never';
    lines.push(`downloader: ${d.activeDownloads > 0 ? `${d.activeDownloads} active` : 'idle'} | last: ${last}`);
  }
  if (s.scrobbleSync) {
    const entries = Object.entries(s.scrobbleSync);
    if (entries.length) {
      const parts = entries.map(([name, v]) => {
        const when = v.lastSyncedAt ? formatDuration(Date.now() - new Date(v.lastSyncedAt).getTime()) + ' ago' : 'never';
        return `${name} synced ${when}`;
      });
      lines.push(`scrobble-sync: ${parts.join(' | ')}`);
    }
  }
  if (s.castSession) {
    const c = s.castSession;
    lines.push(`cast: ${c.activeSessions > 0 ? `${c.activeSessions} active` : 'no active session'}`);
  }
  if (s.db) {
    lines.push(`db: ${s.db.error ? `error: ${s.db.error}` : `ok | size: ${s.db.sizeMB} MB`}`);
  }
  if (s.upgrader) {
    lines.push(`upgrader-state: ${s.upgrader.idle === true ? 'idle' : s.upgrader.idle === false ? 'busy' : 'unknown'}`);
  }
  lines.push('');

  // --- Recent errors ---
  const errors = serverData.recentErrors || [];
  if (errors.length) {
    lines.push(`--- RECENT ERRORS (server, last ${errors.length}) ---`);
    for (const e of errors) {
      lines.push(`[${formatTs(e.ts)}] ${e.category}: ${e.message}`);
    }
    lines.push('');
  }

  // --- Client state ---
  lines.push('--- CLIENT STATE ---');
  if (appState) {
    const parts = [];
    if (appState.view) parts.push(`view: ${appState.view}`);
    if (appState.user) parts.push(`user: ${appState.user}`);
    if (appState.currentTrack) {
      parts.push(`playing: "${appState.currentTrack.title}" by ${appState.currentTrack.artist}`);
    } else {
      parts.push('playing: nothing');
    }
    lines.push(parts.join(' | '));

    const dlParts = [];
    dlParts.push(`downloads: ${appState.downloading ? 'active' : 'idle'}`);
    dlParts.push(`bg: ${appState.bgDownloadStatus ? 'active' : 'idle'}`);
    lines.push(dlParts.join(' | '));

    // SSE connections
    const sseEntries = Object.entries(_sseConnections);
    if (sseEntries.length) {
      const sseParts = sseEntries.map(([name, s]) => {
        const lastEvt = s.lastEventAt ? `${formatDuration(Date.now() - s.lastEventAt)} ago` : 'no events';
        return `${name} ${s.open ? 'ok' : 'disconnected'} (last ${lastEvt})`;
      });
      lines.push(`sse: ${sseParts.join(' | ')}`);
    }
  } else {
    lines.push('(app state unavailable)');
  }
  lines.push('');

  // --- Client errors ---
  if (_errors.length) {
    lines.push(`--- CLIENT ERRORS (last ${Math.min(_errors.length, 10)}) ---`);
    for (const e of _errors.slice(-10)) {
      lines.push(`[${formatTs(e.ts)}] ${e.message}`);
    }
    lines.push('');
  }

  // --- API calls ---
  if (_apiCalls.length) {
    lines.push(`--- API CALLS (last ${_apiCalls.length}) ---`);
    for (const c of _apiCalls) {
      if (c.error) {
        lines.push(`${c.method} ${c.path} ERR ${c.latency}ms — ${c.error}`);
      } else {
        lines.push(`${c.method} ${c.path} ${c.status} ${c.latency}ms`);
      }
    }
    lines.push('');
  }

  // --- Environment ---
  lines.push('--- ENVIRONMENT ---');
  const envParts = [];
  envParts.push(`viewport: ${window.innerWidth}x${window.innerHeight}`);
  envParts.push(`agent: ${navigator.userAgent.split(') ').pop()}`);
  envParts.push(`page uptime: ${formatDuration(Date.now() - _bootTime)}`);
  lines.push(envParts.join(' | '));
  lines.push(`server: v${v} | node: ${serverData.nodeVersion || '?'} | platform: ${serverData.platform || '?'}`);

  return lines.join('\n');
}

/**
 * One-click: fetch server diagnostics, merge with client state, return formatted text.
 */
export async function copyDiagnostics() {
  const serverData = await api.getDiagnostics();
  const appState = typeof window.__notifyDiagnostics === 'function' ? window.__notifyDiagnostics() : null;
  const text = formatDiagnostics(serverData, appState);
  await navigator.clipboard.writeText(text);
  return text;
}
```

- [ ] **Step 2: Verify build**

Run: `cd packages/client && npm run build`

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/services/client-diagnostics.js
git commit -m "feat(diagnostics): add client-side diagnostics collector and formatter"
```

---

### Task 8: Wire up App.jsx — register collectors and expose state getter

**Files:**
- Modify: `packages/client/src/App.jsx`

- [ ] **Step 1: Import and initialize collectors**

Near the top of App.jsx, add imports:

```javascript
import { onApiRequest, startErrorCapture } from './services/client-diagnostics';
```

**Important:** `api.configure()` is never called in the existing codebase. The client uses `api.setUser()` directly. Add a new `api.configure()` call in the top-level `App()` function (around line 852), before the `useEffect` that calls `api.setUser()`. This registers the onRequest hook at startup:

```javascript
// In App() component, at module init or in the first useEffect:
useEffect(() => {
  api.configure({ onRequest: onApiRequest });
  startErrorCapture();
}, []);
```

The `configure()` function preserves existing `_baseUrl` (defaults to `''`) so this is safe to add without breaking existing behavior.

- [ ] **Step 2: Register window.__notifyDiagnostics in MainApp**

Inside `MainApp`, add a `useEffect` that registers the state getter:

```javascript
useEffect(() => {
  window.__notifyDiagnostics = () => ({
    view,
    user: currentUser,
    currentTrack: currentTrack ? { title: currentTrack.title, artist: currentAlbumInfo?.artist } : null,
    isPlaying,
    downloading: !!downloading,
    bgDownloadStatus: !!bgDownloadStatus,
    downloadStatus: downloadStatus ? { step: downloadStatus.step, message: downloadStatus.message, complete: downloadStatus.complete, error: downloadStatus.error } : null,
    queueLength: queue?.length || 0,
    libraryCount: library?.length || 0,
    castActive: !!cast?.activeDevice,
  });
  return () => { delete window.__notifyDiagnostics; };
});
```

- [ ] **Step 3: Wire SSE tracking in ActivityLog.jsx**

In `ActivityLog.jsx`, where the EventSource is created (line 113), add tracking calls:

```javascript
import { trackSseOpen, trackSseClose, trackSseEvent } from '../services/client-diagnostics';

// In the useEffect where EventSource is created:
const es = new EventSource(url);
trackSseOpen('activity');

es.onmessage = (event) => {
  trackSseEvent('activity');
  // ... existing handler
};

// In the cleanup:
return () => {
  es.close();
  trackSseClose('activity');
  eventSourceRef.current = null;
};
```

Similarly, any other SSE connections in the app (cast status stream, recently-played stream) should call `trackSseOpen`/`trackSseClose`/`trackSseEvent` with their respective names. These can be wired incrementally — the activity stream is the most important one.

- [ ] **Step 4: Verify build**

Run: `cd packages/client && npm run build`

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/App.jsx packages/client/src/components/ActivityLog.jsx
git commit -m "feat(diagnostics): wire up client collectors, state getter, and SSE tracking"
```

---

### Task 9: Enrich Status tab and add "Copy Diagnostics" button

**Files:**
- Modify: `packages/client/src/components/ActivityLog.jsx`

- [ ] **Step 1: Replace StatusTab with enriched version**

Replace the existing `StatusTab` component. It should now:
1. Call `/api/diagnostics` instead of `/api/health/services`
2. Render a "Copy Diagnostics" button at the top
3. Show external connectivity checks (from the existing health data, pulled into diagnostics)
4. Show internal service state cards below

```javascript
import { copyDiagnostics } from '../services/client-diagnostics';
```

Update `StatusTab`:
- Replace the `api.getServiceHealth()` call with `api.getDiagnostics()`
- Add a "Copy Diagnostics" button at the top with a `[copied]` toast state
- Render each service from `data.services` as a status row:
  - Green dot for healthy/running/configured services
  - Yellow dot for unknown/untested
  - Red dot for errors/unhealthy/missing
- Keep the refresh button
- Handle the case where `/api/diagnostics` returns 401/403 (non-admin user) by falling back to `getServiceHealth()`

The "Copy Diagnostics" button handler:

```javascript
async function handleCopy() {
  try {
    await copyDiagnostics();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  } catch (err) {
    console.error('Diagnostics copy failed:', err);
  }
}
```

- [ ] **Step 2: Verify build**

Run: `cd packages/client && npm run build`

- [ ] **Step 3: Start preview and verify**

Start the dev server, navigate to the app, open the activity log, click Status tab. Verify:
- Internal service cards render (even if server isn't running, should show error state gracefully)
- "Copy Diagnostics" button is visible
- No console errors from the new code

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/components/ActivityLog.jsx
git commit -m "feat(diagnostics): enrich Status tab with internal services + Copy Diagnostics button"
```

---

### Task 10: Run tests, build, bump version, final commit

**Files:**
- Modify: `package.json` (version bump)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Run all tests**

Run: `npx jest --testPathPatterns="youtube|pipeline|cast|dlna|stream-auth" 2>&1`
Verify all pass.

- [ ] **Step 2: Build client**

Run: `cd packages/client && npm run build`
Verify clean build.

- [ ] **Step 3: Preview verification**

Start dev server, verify:
- Status tab shows service cards
- Copy Diagnostics produces formatted text in clipboard
- No console errors

- [ ] **Step 4: Version bump + changelog**

Bump version in `package.json` (minor version bump, e.g., 1.2.1 → 1.3.0).
Update `CHANGELOG.md` with diagnostics feature entry.

- [ ] **Step 5: Final commit + push**

```bash
git add -A
git commit -m "feat(diagnostics): one-click diagnostic export for debugging, bump to v1.3.0"
git push
```
