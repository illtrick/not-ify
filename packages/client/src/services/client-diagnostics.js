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
