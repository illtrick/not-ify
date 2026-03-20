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
| job-queue | pending/active/done/failed counts, oldest pending job age |
| llm | healthy, modelReady, cacheSize, lastCheckAt |
| youtube (service) | activeProcesses, searchCacheSize, urlCacheSize |
| dlna | device count + names, lastScanAt |
| file-validator | tool availability: file, ffprobe, clamdscan (probed once at startup) |
| scrobble-sync | per-user sync state and lastSyncAt |
| cast-session | active session count + device info |
| quality-upgrader | idle status, last scan time |
| activity-log | entry count, error count since boot, last error message |

Each getter reads cached state or does a quick DB count. No heavy I/O.

**New endpoint:** `GET /api/diagnostics` returns the full aggregated object with a `serverUptime` field.

### Client-Side Diagnostic Collector

A `client-diagnostics.js` module that captures:

| Category | Data |
|----------|------|
| App state | current view, user, playing track, album info, queue length, download status |
| API calls | last 20 calls: endpoint, status, latency; failed calls with error (max 50) |
| SSE connections | which streams are open, reconnection count, last event time |
| Errors | uncaught exceptions + unhandled rejections since page load (max 50) |
| Context | viewport size, user agent, page uptime (since load) |

**Implementation:**
- Wraps `api-client.js` fetch to log call metadata (not response bodies)
- Listens for `window.onerror` and `unhandledrejection`
- Reads React state only when export is triggered (not continuously)
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
file-validator: file ok | ffprobe ok | clamdscan missing
scrobble-sync: nathan synced 2h ago | sarah synced 6h ago
cast: no active session

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
GET /api/cover/search?artist=... 500 120ms

--- ENVIRONMENT ---
viewport: 1920x1080 | agent: Chrome 120 | page uptime: 1h03m
server: v1.2.2 | node: 20.x | platform: linux/docker
```

### UI Integration

- Existing Status tab in ActivityLog.jsx is enriched with internal service health cards
- A "Copy Diagnostics" button at the top of the Status tab triggers the export
- Clicking it: calls `/api/diagnostics`, merges with client state, formats text, copies to clipboard
- Brief toast: "Diagnostics copied"
- No new panels, views, or modals

## Files

**New:**
- `packages/server/src/services/diagnostics.js` — aggregator
- `packages/client/src/services/client-diagnostics.js` — client collector

**Modified (add `getStatus()`):**
- `packages/server/src/services/job-worker.js`
- `packages/server/src/services/job-queue.js`
- `packages/server/src/services/llm.js`
- `packages/server/src/services/youtube.js`
- `packages/server/src/services/dlna.js`
- `packages/server/src/services/file-validator.js`
- `packages/server/src/services/scrobble-sync.js`
- `packages/server/src/services/cast-session.js`
- `packages/server/src/services/quality-upgrader.js`
- `packages/server/src/services/activity-log.js`

**Modified (endpoint + integration):**
- `packages/server/src/index.js` — add `GET /api/diagnostics`
- `packages/shared/src/api-client.js` — add `getDiagnostics()`
- `packages/client/src/components/ActivityLog.jsx` — enriched Status tab + Copy button
- `packages/client/src/App.jsx` — expose state snapshot for diagnostics

**Not changing:**
- No new logging framework
- No persistent log storage
- No new SSE streams
- No new UI panels
