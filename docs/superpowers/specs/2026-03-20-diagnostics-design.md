# Diagnostics & Observability System

## Problem

Internal application services (upgrader, LLM, ClamAV, DLNA, YouTube queue, scrobble sync) have no visibility in the UI. Errors vanish into console logs. When something breaks, the user has to describe symptoms manually — there's no way to export a full system snapshot for debugging.

## Solution

A one-click diagnostic export that bundles server-side service state and client-side app state into a single copy-pasteable text blob. Integrated into the existing Status tab in the Activity Log panel.

## Design

### Server-Side Service Registry

Each service gets a lightweight `getStatus()` function that returns its current state. A new `diagnostics.js` service aggregates them all.

**Services and their exposed state:**

| Service | State |
|---------|-------|
| job-worker | running, lastJobAt, lastErrorAt, jobsProcessed, jobsFailed |
| job-queue | pending/active/done/failed counts, oldest pending job age (DB query with index on status) |
| llm | healthy, modelReady, cacheSize (Object.keys length), lastCheckAt |
| youtube (service) | activeProcesses, searchCache.size, urlCache.size |
| dlna | device count + names, lastScanAt (new timestamp variable) |
| file-validator | tool availability: file, ffprobe, clamdscan — reports "untested" until first `validateFile()` call, then caches result |
| scrobble-sync | per-user sync state and lastSyncAt (queries DB via `getUserSetting` per user) |
| cast-session | active session count + device info |
| quality-upgrader | idle status, last scan time — accessed via `getUpgrader()` from upgrade API module |
| activity-log | entry count, error count since boot, last error message |
| realdebrid | API key configured (boolean), last call success/failure, last error |
| downloader | active download count, current progress, last completed/failed |
| db | database file size, connection status |

Each getter reads cached/module-scoped state or does a quick indexed DB query. The aggregator wraps each `getStatus()` call in try/catch — one failing service returns `{ error: "getStatus failed: ..." }` without breaking the entire response.

**New endpoint:** `GET /api/diagnostics` — protected by `adminGuard` middleware (consistent with `/api/realdebrid`, `/api/vpn`). Returns the full aggregated object with `serverUptime` and `version` (from package.json).

**Relationship to existing health endpoint:** `/api/health/services` remains unchanged (external connectivity checks). `/api/diagnostics` is a superset that includes internal service state. The Status tab will call `/api/diagnostics` instead of `/api/health/services` and render both external checks and internal state.

### Client-Side Diagnostic Collector

A `client-diagnostics.js` module that captures:

| Category | Data |
|----------|------|
| App state | current view, user, playing track, album info, queue length, download status |
| API calls | last 20 calls: endpoint (path only, query params truncated), status, latency; failed calls with error (max 50) |
| SSE connections | which streams are open, reconnection count, last event time |
| Errors | uncaught exceptions + unhandled rejections since page load (max 50) — complements React error boundaries which only catch render errors |
| Context | viewport size, user agent, page uptime (since load) |

**Implementation:**
- API call logging via an `onRequest` callback added to `api-client.js`'s `configure()` function — not monkey-patching. The diagnostics collector registers the callback on init.
- Listens for `window.onerror` and `unhandledrejection` for async/event handler errors React doesn't catch
- App.jsx exposes a `window.__notifyDiagnostics` getter function that returns current React state (view, user, playing track, download status, etc.) — only called when export is triggered, not continuously
- No continuous overhead — assembles snapshot on demand

### Diagnostic Export Format

Plain text, structured for pasting into a Claude conversation:

```
=== NOT-IFY DIAGNOSTICS v1.2.2 ===
Timestamp: 2026-03-20T15:30:00Z
Uptime: server 4h12m, client 1h03m

--- SERVER SERVICES ---
upgrader: idle | last job: 12m ago (success) | processed: 14 | failed: 2
job-queue: 0 pending, 0 active, 14 done, 2 failed
llm: healthy | model: ready | cache: 23 entries
youtube: 0/2 active | search cache: 8 | url cache: 4
dlna: 3 devices | last scan: 45s ago
file-validator: file ok | ffprobe ok | clamdscan untested
realdebrid: configured | last call: 2m ago (ok)
downloader: idle | last: 15m ago (success)
scrobble-sync: nathan synced 2h ago | sarah synced 6h ago
cast: no active session
db: ok | size: 4.2 MB

--- RECENT ERRORS (server, last 10) ---
[14:22] youtube: Failed: Doctor Robert — validation: mime
[14:18] upgrade: Timeout fetching torrent for Album X

--- CLIENT STATE ---
view: album | user: nathan | playing: "Holy Rage" by Kiki Rockwell
downloads: idle | bg: idle | queue: 0
sse: activity ok (last 3s ago) | cast disconnected

--- CLIENT ERRORS (last 10) ---
[14:25] Failed to fetch: /api/library (timeout)

--- API CALLS (last 20) ---
GET /api/library 200 45ms
GET /api/health/services 200 622ms
GET /api/cover/search 500 120ms

--- ENVIRONMENT ---
viewport: 1920x1080 | agent: Chrome 120 | page uptime: 1h03m
server: v1.2.2 | node: 20.x | platform: linux/docker
```

### UI Integration

- Existing Status tab in ActivityLog.jsx is enriched: external checks (from `/api/health/services` data included in diagnostics response) stay at top, internal service state cards added below
- A "Copy Diagnostics" button at the top of the Status tab triggers the export
- Clicking it: calls `/api/diagnostics`, merges with client state from `window.__notifyDiagnostics()`, formats text, copies to clipboard
- Brief toast: "Diagnostics copied"
- No new panels, views, or modals

## Files

**New:**
- `packages/server/src/services/diagnostics.js` — aggregator with per-service try/catch
- `packages/client/src/services/client-diagnostics.js` — client collector + formatter

**Modified (add `getStatus()`):**
- `packages/server/src/services/job-worker.js` — add counters + getter
- `packages/server/src/services/job-queue.js` — add `getStats()` GROUP BY query
- `packages/server/src/services/llm.js` — expose existing module-scoped state
- `packages/server/src/services/youtube.js` — expose cache sizes + active count
- `packages/server/src/services/dlna.js` — add `lastScanAt` variable + getter
- `packages/server/src/services/file-validator.js` — cache tool availability after first validation call
- `packages/server/src/services/scrobble-sync.js` — expose per-user sync state
- `packages/server/src/services/cast-session.js` — expose active sessions
- `packages/server/src/services/quality-upgrader.js` — expose via `getUpgrader()` in upgrade API
- `packages/server/src/services/activity-log.js` — add error counter + last error
- `packages/server/src/services/realdebrid.js` — track last call result + configured status
- `packages/server/src/services/downloader.js` — track active download + last result

**Modified (endpoint + integration):**
- `packages/server/src/index.js` — add `GET /api/diagnostics` behind `adminGuard`
- `packages/shared/src/api-client.js` — add `getDiagnostics()`, add `onRequest` callback to `configure()`
- `packages/client/src/components/ActivityLog.jsx` — enriched Status tab + Copy button
- `packages/client/src/App.jsx` — register `window.__notifyDiagnostics` getter

**Not changing:**
- No new logging framework
- No persistent log storage
- No new SSE streams
- No new UI panels
