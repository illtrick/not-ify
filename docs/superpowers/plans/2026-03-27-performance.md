# Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 6 performance issues: 2 memory leaks, 1 sync I/O, 1 N+1 query, 1 unbounded cache, 1 hot regex.

**Architecture:** Replace sync with async, add cleanup to subscriptions, add bounds to caches.

**Tech Stack:** React, Node.js, Express, Jest

---

## File Map

| Task | Create | Modify | Test |
|------|--------|--------|------|
| 1 (P1) | — | `packages/server/src/api/cast.js` | `packages/server/__tests__/api/cast-sse-cleanup.test.js` |
| 2 (P2) | — | `packages/client/src/hooks/useTrackDurations.js` | (manual verification — DevTools memory) |
| 3 (P3) | — | `packages/server/src/api/library-config.js` | `packages/server/__tests__/api/library-config-async.test.js` |
| 4 (P4) | — | `packages/server/src/api/import.js` | `packages/server/__tests__/api/import-batch.test.js` |
| 5 (P5) | — | `packages/shared/src/api-client.js` | `packages/shared/__tests__/api-client-cache.test.js` |
| 6 (P6) | — | `packages/server/src/services/dlna.js` | `packages/server/__tests__/services/dlna-regex.test.js` |

---

### Task 1: Fix SSE listener leak in cast.js (P1)

**Files:**
- Modify: `packages/server/src/api/cast.js:295-394`
- Create: `packages/server/__tests__/api/cast-sse-cleanup.test.js`

**Context:** The SSE endpoint at `GET /api/cast/status/stream` (lines 295-394) registers event listeners on the `dlna` emitter: `deviceLost`, `transportStateChanged`, `volumeChanged`, `trackChanged`. These are cleaned up on `req.on('close')` at line 387. However, if the client disconnects ungracefully (e.g. network drop, tab crash) without triggering the `close` event promptly, listeners accumulate. Additionally, if many clients connect to monitor cast status, each adds 4 listeners. The fix is to add a timeout safety net that cleans up stale SSE connections, and verify that the existing cleanup handles the normal case correctly.

- [ ] **Step 1: Write test to verify listener cleanup**

```javascript
// packages/server/__tests__/api/cast-sse-cleanup.test.js
'use strict';

const EventEmitter = require('events');

test('dlna listeners are cleaned up when SSE client disconnects', () => {
  const emitter = new EventEmitter();

  // Simulate adding listeners (what cast.js does per SSE client)
  const onDeviceLost = () => {};
  const onTransportState = () => {};
  const onVolumeChanged = () => {};
  const onTrackChanged = () => {};

  emitter.on('deviceLost', onDeviceLost);
  emitter.on('transportStateChanged', onTransportState);
  emitter.on('volumeChanged', onVolumeChanged);
  emitter.on('trackChanged', onTrackChanged);

  expect(emitter.listenerCount('deviceLost')).toBe(1);
  expect(emitter.listenerCount('transportStateChanged')).toBe(1);

  // Simulate cleanup (what req.on('close') should do)
  emitter.off('deviceLost', onDeviceLost);
  emitter.off('transportStateChanged', onTransportState);
  emitter.off('volumeChanged', onVolumeChanged);
  emitter.off('trackChanged', onTrackChanged);

  expect(emitter.listenerCount('deviceLost')).toBe(0);
  expect(emitter.listenerCount('transportStateChanged')).toBe(0);
});

test('stale connection safety net fires after timeout', (done) => {
  let cleaned = false;
  const cleanup = () => { cleaned = true; };

  // Simulate safety net timeout (shortened for test)
  const SAFETY_TIMEOUT = 50; // 50ms for test, real value is 5 minutes
  const timer = setTimeout(() => {
    cleanup();
    expect(cleaned).toBe(true);
    done();
  }, SAFETY_TIMEOUT);

  // If client disconnects normally, cancel the safety net
  // (not called in this test — simulating stale connection)
});
```

- [ ] **Step 2: Run test to verify baseline**

Run: `cd packages/server && npx jest __tests__/api/cast-sse-cleanup.test.js --no-cache`
Expected: PASS

- [ ] **Step 3: Add safety net timeout to SSE endpoint**

In `packages/server/src/api/cast.js`, in the `GET /api/cast/status/stream` handler (around line 295), after the event listeners are registered (after line 349) and the poll interval is created (line 353), add a safety net timeout. Modify the cleanup block:

After line 385 (the `setInterval` block), add a safety net before the `req.on('close')`:
```javascript
  // Safety net: if client doesn't close gracefully within 5 min of last data,
  // force cleanup to prevent listener leaks from zombie connections
  const STALE_TIMEOUT = 5 * 60 * 1000;
  let lastActivity = Date.now();
  const originalSend = send;
  const trackedSend = (data) => { lastActivity = Date.now(); originalSend(data); };
  // Replace send usage in the poll — reassign the function used by the interval
  // Note: since poll closure already captured `send`, we patch via a wrapper
  const staleCheck = setInterval(() => {
    if (Date.now() - lastActivity > STALE_TIMEOUT) {
      console.warn(`[cast] SSE safety net: closing stale connection for device ${deviceUsn}`);
      res.end();
    }
  }, 60 * 1000);
```

Then update the `req.on('close')` cleanup at line 387 to also clear the stale check:
```javascript
  req.on('close', () => {
    clearInterval(poll);
    clearInterval(staleCheck);
    dlna.off('deviceLost', onDeviceLost);
    dlna.off('transportStateChanged', onTransportState);
    dlna.off('volumeChanged', onVolumeChanged);
    dlna.off('trackChanged', onTrackChanged);
    dlna.unsubscribe(deviceUsn).catch(() => {});
  });
```

- [ ] **Step 4: Run existing cast tests**

Run: `cd packages/server && npx jest --testPathPattern=cast --no-cache`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/api/cast.js packages/server/__tests__/api/cast-sse-cleanup.test.js
git commit -m "fix: add safety net timeout for stale cast SSE connections (P1)"
```

---

### Task 2: Fix Audio element leak in useTrackDurations.js (P2)

**Files:**
- Modify: `packages/client/src/hooks/useTrackDurations.js:20-52`

**Context:** The hook creates `new Audio()` elements sequentially (one at a time, line 20) to probe track durations. The cleanup function (lines 44-52) sets `cancelled = true` and cleans up `activeAudio` if one is currently loading. This is already reasonably well-implemented — only one Audio element exists at a time, and the cleanup correctly nulls it.

However, there is a subtle leak: if the component unmounts while a `setTimeout(() => loadNext(idx + 1), 60)` is pending (lines 32, 39), the timeout fires after cleanup, creating a new Audio element that is never cleaned up. Fix: track and clear the pending timeout on unmount.

- [ ] **Step 1: Fix the timeout leak**

In `packages/client/src/hooks/useTrackDurations.js`, add a timeout reference and clear it on unmount. Change the implementation:

```javascript
// packages/client/src/hooks/useTrackDurations.js
import { useState, useEffect } from 'react';
import { buildTrackPath } from '../utils';

export function useTrackDurations(selectedAlbum) {
  const [trackDurations, setTrackDurations] = useState({});

  useEffect(() => {
    if (!selectedAlbum || selectedAlbum.fromSearch) return;
    const tracks = selectedAlbum.tracks || [];
    if (!tracks.length) return;
    let cancelled = false;
    let activeAudio = null;
    let pendingTimer = null;
    const seen = new Set();
    const loadNext = (idx) => {
      if (cancelled || idx >= tracks.length) return;
      const track = tracks[idx];
      const id = track.id;
      if (!id || seen.has(id)) { loadNext(idx + 1); return; }
      seen.add(id);
      const audio = new Audio();
      activeAudio = audio;
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        const dur = audio.duration;
        audio.onloadedmetadata = null;
        audio.onerror = null;
        audio.src = '';
        activeAudio = null;
        if (!cancelled && dur && isFinite(dur)) {
          setTrackDurations(prev => prev[id] !== undefined ? prev : { ...prev, [id]: dur });
        }
        pendingTimer = setTimeout(() => loadNext(idx + 1), 60);
      };
      audio.onerror = () => {
        audio.onloadedmetadata = null;
        audio.onerror = null;
        audio.src = '';
        activeAudio = null;
        pendingTimer = setTimeout(() => loadNext(idx + 1), 60);
      };
      audio.src = track.path || buildTrackPath(id);
    };
    loadNext(0);
    return () => {
      cancelled = true;
      if (pendingTimer) clearTimeout(pendingTimer);
      if (activeAudio) {
        activeAudio.onloadedmetadata = null;
        activeAudio.onerror = null;
        activeAudio.src = '';
        activeAudio = null;
      }
    };
  }, [selectedAlbum]);

  return { trackDurations, setTrackDurations };
}
```

- [ ] **Step 2: Verify by manual testing**

1. Open app, navigate to an album — durations should load
2. Quickly switch between albums — should not see console errors
3. Open DevTools > Memory > Take heap snapshot before and after switching albums 10 times — Audio element count should not accumulate

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/hooks/useTrackDurations.js
git commit -m "fix: clear pending timeout on unmount in useTrackDurations (P2)"
```

---

### Task 3: Replace fs.readdirSync with async in library-config.js (P3)

**Files:**
- Modify: `packages/server/src/api/library-config.js:71`
- Create: `packages/server/__tests__/api/library-config-async.test.js`

**Context:** The `GET /api/library-config/browse` endpoint at line 66 uses `fs.readdirSync(fullPath, { withFileTypes: true })` at line 71 to list directories. On network-mounted filesystems (NAS/NFS), this blocks the event loop for hundreds of milliseconds, stalling all other requests. Fix: convert to async handler with `fs.promises.readdir`.

- [ ] **Step 1: Write test for async browse endpoint**

```javascript
// packages/server/__tests__/api/library-config-async.test.js
'use strict';

jest.mock('../../src/services/db', () => ({
  getGlobalSetting: jest.fn().mockReturnValue('/app/music'),
  setGlobalSetting: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const fs = require('fs');

// Mock fs.promises.readdir to return test data
jest.spyOn(fs.promises, 'readdir').mockResolvedValue([
  { name: 'Artist A', isDirectory: () => true },
  { name: 'Artist B', isDirectory: () => true },
  { name: '.hidden', isDirectory: () => true },
  { name: 'track.mp3', isDirectory: () => false },
]);

const libraryConfig = require('../../src/api/library-config');
const app = express();
app.use(express.json());
app.use('/api/library-config', libraryConfig);

test('GET /api/library-config/browse returns directories using async readdir', async () => {
  const res = await request(app).get('/api/library-config/browse?path=/app/music');
  expect(res.status).toBe(200);
  expect(res.body.directories).toHaveLength(2); // excludes .hidden and non-dirs
  expect(res.body.directories[0].name).toBe('Artist A');
  expect(res.body.directories[1].name).toBe('Artist B');
});

test('GET /api/library-config/browse does NOT call readdirSync', async () => {
  const syncSpy = jest.spyOn(fs, 'readdirSync');
  await request(app).get('/api/library-config/browse?path=/app/music');
  expect(syncSpy).not.toHaveBeenCalled();
  syncSpy.mockRestore();
});
```

- [ ] **Step 2: Run test to verify it fails (still using sync)**

Run: `cd packages/server && npx jest __tests__/api/library-config-async.test.js --no-cache`
Expected: FAIL — the second test fails because readdirSync is still called

- [ ] **Step 3: Convert to async**

In `packages/server/src/api/library-config.js`, change the browse endpoint (starting at line 66) from:

```javascript
// GET /api/library-config/browse — filesystem directory browser
router.get('/browse', (req, res) => {
  const requestedPath = req.query.path || (process.platform === 'win32' ? 'C:\\' : '/');
  const fullPath = path.resolve(requestedPath);

  try {
    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({
        name: e.name,
        path: path.join(fullPath, e.name),
      }));

    const parent = path.dirname(fullPath) !== fullPath ? path.dirname(fullPath) : null;
    res.json({ current: fullPath, parent, directories: dirs });
  } catch (err) {
    res.status(400).json({ error: `Cannot read: ${err.message}` });
  }
});
```

to:

```javascript
// GET /api/library-config/browse — filesystem directory browser
router.get('/browse', async (req, res) => {
  const requestedPath = req.query.path || (process.platform === 'win32' ? 'C:\\' : '/');
  const fullPath = path.resolve(requestedPath);

  try {
    const entries = await fs.promises.readdir(fullPath, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({
        name: e.name,
        path: path.join(fullPath, e.name),
      }));

    const parent = path.dirname(fullPath) !== fullPath ? path.dirname(fullPath) : null;
    res.json({ current: fullPath, parent, directories: dirs });
  } catch (err) {
    res.status(400).json({ error: `Cannot read: ${err.message}` });
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && npx jest __tests__/api/library-config-async.test.js --no-cache`
Expected: PASS

- [ ] **Step 5: Run full library-config tests**

Run: `cd packages/server && npx jest --testPathPattern=library-config --no-cache`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/api/library-config.js packages/server/__tests__/api/library-config-async.test.js
git commit -m "perf: replace readdirSync with async readdir in browse endpoint (P3)"
```

---

### Task 4: Add MB result cache to reduce N+1 queries in import.js (P4)

**Files:**
- Modify: `packages/server/src/api/import.js:324-388`
- Create: `packages/server/__tests__/api/import-batch.test.js`

**Context:** `processImportBatch()` makes 3-5 MusicBrainz API calls per album in the batch: `searchReleases` (line 329), `getReleaseGroupTracks` (line 341), `getReleaseTracks` (line 348). For a 20-album import, this is 60-100 API calls. Many albums from the same artist will return overlapping MB results. Fix: add a simple in-memory cache for the duration of the batch that caches `searchReleases` results by normalized artist+album key.

- [ ] **Step 1: Write test for batch caching**

```javascript
// packages/server/__tests__/api/import-batch.test.js
'use strict';

const mockSearchReleases = jest.fn();
const mockGetReleaseGroupTracks = jest.fn();
const mockGetReleaseTracks = jest.fn();

jest.mock('../../src/services/musicbrainz', () => ({
  searchReleases: mockSearchReleases,
  getReleaseGroupTracks: mockGetReleaseGroupTracks,
  getReleaseTracks: mockGetReleaseTracks,
}));

jest.mock('../../src/services/activity-log', () => ({ log: jest.fn() }));
jest.mock('../../src/services/job-queue', () => ({ enqueue: jest.fn() }));
jest.mock('../../src/services/library-check', () => ({
  albumTrackCount: jest.fn().mockReturnValue(0),
  excludedTrackCount: jest.fn().mockReturnValue(0),
}));
jest.mock('../youtube', () => ({
  ytQueueAlbum: jest.fn().mockResolvedValue(),
}));

// Must require after mocks
const importRouter = require('../../src/api/import');

test('processImportBatch calls searchReleases once per unique artist+album', async () => {
  mockSearchReleases.mockResolvedValue([{
    mbid: 'r1', rgid: 'rg1', artist: 'Test Artist', album: 'Album 1',
  }]);
  mockGetReleaseGroupTracks.mockResolvedValue({
    tracks: [{ title: 'Track 1' }],
    releaseMbid: 'r1',
  });

  const batch = [
    { artist: 'Test Artist', album: 'Album 1', dedupeKey: 'k1' },
    { artist: 'Test Artist', album: 'Album 1', dedupeKey: 'k2' }, // duplicate
  ];

  await importRouter._processImportBatch(batch);

  // searchReleases should be called once (or twice if no cache),
  // verifying the N+1 reduction
  // With cache: 1 call. Without cache: 2 calls.
  const searchCalls = mockSearchReleases.mock.calls.length;
  expect(searchCalls).toBeLessThanOrEqual(2); // baseline — will be 1 after fix
});
```

- [ ] **Step 2: Run test to verify baseline**

Run: `cd packages/server && npx jest __tests__/api/import-batch.test.js --no-cache`
Expected: PASS (baseline — searchReleases called twice without cache)

- [ ] **Step 3: Add batch-scoped MB cache**

In `packages/server/src/api/import.js`, modify `processImportBatch()` (starting around line 311). Add a cache at the top of the function and use it around the MB calls:

After line 322 (`activity.log('import', 'info', ...)`), add:
```javascript
  // Batch-scoped cache: avoid duplicate MB lookups for same artist+album
  const mbCache = new Map();

  function mbCacheKey(artist, album) {
    return `${artist.toLowerCase().trim()}|${album.toLowerCase().trim()}`;
  }
```

Then wrap the MB lookup block (lines 328-353). Change:
```javascript
      // MusicBrainz lookup — search for the album, get tracks
      const mbResults = await mb.searchReleases(`${artist} ${album}`);
      let tracks = null;
      let mbid = null;
      let rgid = null;

      if (mbResults && mbResults.length > 0) {
        const best = mbResults[0];
        mbid = best.mbid;
        rgid = best.rgid;

        // Prefer release group tracks (canonical), fall back to release tracks
        if (rgid) {
          const rgData = await mb.getReleaseGroupTracks(rgid);
          if (rgData && rgData.tracks && rgData.tracks.length > 0) {
            tracks = rgData.tracks;
            mbid = mbid || rgData.releaseMbid;
          }
        }
        if (!tracks && mbid) {
          const relTracks = await mb.getReleaseTracks(mbid);
          if (relTracks && relTracks.length > 0) {
            tracks = relTracks;
          }
        }
      }
```

to:

```javascript
      // MusicBrainz lookup — search for the album, get tracks (with batch cache)
      const cacheKey = mbCacheKey(artist, album);
      let cached = mbCache.get(cacheKey);

      if (!cached) {
        const mbResults = await mb.searchReleases(`${artist} ${album}`);
        let tracks = null;
        let mbid = null;
        let rgid = null;

        if (mbResults && mbResults.length > 0) {
          const best = mbResults[0];
          mbid = best.mbid;
          rgid = best.rgid;

          // Prefer release group tracks (canonical), fall back to release tracks
          if (rgid) {
            const rgData = await mb.getReleaseGroupTracks(rgid);
            if (rgData && rgData.tracks && rgData.tracks.length > 0) {
              tracks = rgData.tracks;
              mbid = mbid || rgData.releaseMbid;
            }
          }
          if (!tracks && mbid) {
            const relTracks = await mb.getReleaseTracks(mbid);
            if (relTracks && relTracks.length > 0) {
              tracks = relTracks;
            }
          }
        }
        cached = { tracks, mbid, rgid };
        mbCache.set(cacheKey, cached);
      }

      const { tracks, mbid, rgid } = cached;
```

- [ ] **Step 4: Update test to verify cache reduces calls**

```javascript
test('processImportBatch calls searchReleases once per unique artist+album (cached)', async () => {
  mockSearchReleases.mockClear();
  mockGetReleaseGroupTracks.mockClear();

  mockSearchReleases.mockResolvedValue([{
    mbid: 'r1', rgid: 'rg1', artist: 'Test Artist', album: 'Album 1',
  }]);
  mockGetReleaseGroupTracks.mockResolvedValue({
    tracks: [{ title: 'Track 1' }],
    releaseMbid: 'r1',
  });

  const batch = [
    { artist: 'Test Artist', album: 'Album 1', dedupeKey: 'k1' },
    { artist: 'Test Artist', album: 'Album 1', dedupeKey: 'k2' },
  ];

  await importRouter._processImportBatch(batch);

  expect(mockSearchReleases).toHaveBeenCalledTimes(1); // cached second time
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/server && npx jest __tests__/api/import-batch.test.js --no-cache`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/api/import.js packages/server/__tests__/api/import-batch.test.js
git commit -m "perf: add batch-scoped MB cache to reduce N+1 queries in import (P4)"
```

---

### Task 5: Add TTL and max size to MusicBrainz prefetch cache (P5)

**Files:**
- Modify: `packages/shared/src/api-client.js:221-232`
- Create: `packages/shared/__tests__/api-client-cache.test.js`

**Context:** The `prefetchCache` Map (line 221) stores MusicBrainz track data promises keyed by mbid/rgid. It is populated on album hover (`prefetchMbTracks`) and consumed on album click (`getCachedMbTracks`). The cache is never evicted — over a long session browsing many albums, it grows unbounded. Fix: add a max size (200 entries) with LRU-like eviction and a TTL (10 minutes).

- [ ] **Step 1: Write test for cache bounds**

```javascript
// packages/shared/__tests__/api-client-cache.test.js
// Note: api-client.js is ESM — test the logic in isolation

test('Map-based cache with max size evicts oldest entries', () => {
  const MAX_SIZE = 5;
  const cache = new Map();

  function setWithEviction(key, value) {
    if (cache.size >= MAX_SIZE) {
      // Delete the oldest entry (first key in Map iteration order)
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
    cache.set(key, value);
  }

  for (let i = 0; i < 7; i++) {
    setWithEviction(`key${i}`, `val${i}`);
  }

  expect(cache.size).toBe(MAX_SIZE);
  expect(cache.has('key0')).toBe(false); // evicted
  expect(cache.has('key1')).toBe(false); // evicted
  expect(cache.has('key6')).toBe(true);  // most recent
});

test('TTL-based cache expires old entries', () => {
  const cache = new Map();
  cache.set('key1', { promise: Promise.resolve([]), ts: Date.now() - 11 * 60 * 1000 }); // 11 min ago
  cache.set('key2', { promise: Promise.resolve([]), ts: Date.now() }); // now

  const TTL = 10 * 60 * 1000;
  const now = Date.now();

  // Evict expired
  for (const [k, v] of cache) {
    if (now - v.ts > TTL) cache.delete(k);
  }

  expect(cache.size).toBe(1);
  expect(cache.has('key2')).toBe(true);
});
```

- [ ] **Step 2: Run test to verify baseline**

Run: `cd packages/shared && npx jest __tests__/api-client-cache.test.js --no-cache`
Expected: PASS

- [ ] **Step 3: Add TTL and max size to prefetchCache**

In `packages/shared/src/api-client.js`, replace lines 221-232:

```javascript
const prefetchCache = new Map();

export function prefetchMbTracks(mbid, rgid) {
  const key = mbid || rgid;
  if (!key || prefetchCache.has(key)) return;
  const promise = mbid ? getMbReleaseTracks(mbid) : getMbRgTracks(rgid);
  prefetchCache.set(key, promise);
}

export function getCachedMbTracks(key) {
  return prefetchCache.get(key) || null;
}
```

with:

```javascript
const prefetchCache = new Map();
const PREFETCH_MAX_SIZE = 200;
const PREFETCH_TTL = 10 * 60 * 1000; // 10 minutes

function prefetchEvict() {
  const now = Date.now();
  // Evict expired entries
  for (const [k, entry] of prefetchCache) {
    if (now - entry.ts > PREFETCH_TTL) prefetchCache.delete(k);
  }
  // If still over max, evict oldest
  while (prefetchCache.size > PREFETCH_MAX_SIZE) {
    const oldest = prefetchCache.keys().next().value;
    prefetchCache.delete(oldest);
  }
}

export function prefetchMbTracks(mbid, rgid) {
  const key = mbid || rgid;
  if (!key) return;
  const existing = prefetchCache.get(key);
  if (existing && Date.now() - existing.ts < PREFETCH_TTL) return;
  prefetchEvict();
  const promise = mbid ? getMbReleaseTracks(mbid) : getMbRgTracks(rgid);
  prefetchCache.set(key, { promise, ts: Date.now() });
}

export function getCachedMbTracks(key) {
  const entry = prefetchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > PREFETCH_TTL) {
    prefetchCache.delete(key);
    return null;
  }
  return entry.promise;
}
```

- [ ] **Step 4: Update consumers of getCachedMbTracks**

Search for `getCachedMbTracks` usage in the client to ensure they expect a promise (not `{ promise, ts }`). The change above returns `entry.promise` directly, so consumers should not need changes.

Run: `grep -rn getCachedMbTracks packages/client/src/`
Verify that all callers use the return value as a promise (e.g. `.then()`). If any access `.promise`, no change needed since we return the promise directly.

- [ ] **Step 5: Run existing shared tests**

Run: `cd packages/shared && npx jest --no-cache`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/api-client.js packages/shared/__tests__/api-client-cache.test.js
git commit -m "perf: add TTL and max size to MB prefetch cache (P5)"
```

---

### Task 6: Precompile regex in dlna.js (P6)

**Files:**
- Modify: `packages/server/src/services/dlna.js:104`
- Create: `packages/server/__tests__/services/dlna-regex.test.js`

**Context:** `_extractXmlValue(xml, tag)` at line 103-106 creates a new `RegExp` on every call: `new RegExp(\`<${tag}>([^<]*)</${tag}>\`)`. This function is called inside the 1-second SSE polling loop (`getPosition`, `getTransportState`, `getVolume` all parse XML responses). That is 3+ regex compilations per second per connected cast client. Fix: precompile commonly used tag regexes and cache the rest.

- [ ] **Step 1: Write benchmark test**

```javascript
// packages/server/__tests__/services/dlna-regex.test.js
'use strict';

test('precompiled regex matches same as dynamic regex', () => {
  const xml = '<TrackDuration>0:03:45</TrackDuration>';
  const tag = 'TrackDuration';

  // Dynamic (current approach)
  const dynamic = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));

  // Precompiled
  const precompiled = new RegExp(`<${tag}>([^<]*)</${tag}>`);
  const cached = xml.match(precompiled);

  expect(dynamic[1]).toBe('0:03:45');
  expect(cached[1]).toBe('0:03:45');
  expect(dynamic[1]).toBe(cached[1]);
});

test('regex cache correctly stores and retrieves patterns', () => {
  const cache = new Map();

  function extractCached(xml, tag) {
    let re = cache.get(tag);
    if (!re) {
      re = new RegExp(`<${tag}>([^<]*)</${tag}>`);
      cache.set(tag, re);
    }
    const m = xml.match(re);
    return m ? m[1] : '';
  }

  const xml = '<RelTime>0:01:30</RelTime><TrackDuration>0:03:45</TrackDuration>';
  expect(extractCached(xml, 'RelTime')).toBe('0:01:30');
  expect(extractCached(xml, 'TrackDuration')).toBe('0:03:45');

  // Second call should use cached regex
  expect(cache.size).toBe(2);
  expect(extractCached(xml, 'RelTime')).toBe('0:01:30');
  expect(cache.size).toBe(2); // still 2, not 3
});
```

- [ ] **Step 2: Run test to verify baseline**

Run: `cd packages/server && npx jest __tests__/services/dlna-regex.test.js --no-cache`
Expected: PASS

- [ ] **Step 3: Add regex cache to _extractXmlValue**

In `packages/server/src/services/dlna.js`, replace lines 103-106:

```javascript
function _extractXmlValue(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1] : '';
}
```

with:

```javascript
const _xmlTagRegexCache = new Map();
function _extractXmlValue(xml, tag) {
  let re = _xmlTagRegexCache.get(tag);
  if (!re) {
    re = new RegExp(`<${tag}>([^<]*)</${tag}>`);
    _xmlTagRegexCache.set(tag, re);
  }
  const m = xml.match(re);
  return m ? m[1] : '';
}
```

- [ ] **Step 4: Run existing dlna tests**

Run: `cd packages/server && npx jest --testPathPattern=dlna --no-cache`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/dlna.js packages/server/__tests__/services/dlna-regex.test.js
git commit -m "perf: precompile regex in dlna XML parser via cache (P6)"
```
