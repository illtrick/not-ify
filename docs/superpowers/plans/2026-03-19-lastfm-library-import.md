# Last.fm Library Import & Personalized Search — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable users to seed their music library from Last.fm history with personalized search ranking, backed by a hardened download pipeline.

**Architecture:** Five phases: (A) harden the download pipeline with a job queue worker, timeouts, dupe/downgrade protection; (B) speed up search with parallelization and caching; (C) sync Last.fm scrobble history to local SQLite; (D) use scrobble data to personalize search ranking; (E) one-click library import from Last.fm history.

**Tech Stack:** Node.js, Express, better-sqlite3, Jest + supertest, React hooks, Last.fm API, MusicBrainz API, RealDebrid API.

**Spec:** `docs/superpowers/specs/2026-03-19-lastfm-library-import-design.md`

---

## Phase A: Download Pipeline Hardening

### Task 1: Job Queue Worker Service

**Context:** `packages/server/src/services/job-queue.js` already exists with a `jobs` table, `enqueue()`, `dequeue()`, `complete()`, `fail()`. What's missing is the worker that polls and processes jobs, plus the `job_log` table for analysis.

**Files:**
- Create: `packages/server/src/services/job-worker.js`
- Create: `packages/server/__tests__/services/job-worker.test.js`
- Modify: `packages/server/src/services/db.js` (add `job_log` table)
- Modify: `packages/server/src/index.js` (start worker on boot)

- [ ] **Step 1: Write the job_log table migration in db.js**

Add after existing CREATE TABLE statements (around line 110 in db.js):

```sql
CREATE TABLE IF NOT EXISTS job_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER,
  artist TEXT,
  album TEXT,
  attempt INTEGER,
  duration_ms INTEGER,
  outcome TEXT,
  fail_reason TEXT,
  quality TEXT,
  created_at INTEGER DEFAULT (unixepoch())
)
```

Export new functions: `addJobLog(entry)` and `getJobLogs(limit)`.

- [ ] **Step 2: Write failing tests for the worker**

Test file: `packages/server/__tests__/services/job-worker.test.js`

```javascript
const os = require('os');
const path = require('path');
process.env.CONFIG_DIR = path.join(os.tmpdir(), `notify-test-${process.pid}`);

const jobQueue = require('../../src/services/job-queue');
const db = require('../../src/services/db');

afterAll(() => db.close());

describe('job-worker', () => {
  test('processNextJob picks highest priority first', async () => {
    jobQueue.enqueue('download', { artist: 'BG', album: 'BG' }, { priority: 0 }); // background
    jobQueue.enqueue('download', { artist: 'Manual', album: 'Manual' }, { priority: 1 }); // manual
    const worker = require('../../src/services/job-worker');
    worker.setProcessor(async (job) => JSON.parse(job.payload));
    await worker.processNextJob();
    // Manual (priority 1) should be dequeued first
    const remaining = jobQueue.getByStatus('pending');
    expect(remaining.length).toBe(1);
    expect(JSON.parse(remaining[0].payload).artist).toBe('BG');
  });

  test('processNextJob returns false when queue empty', async () => {
    const worker = require('../../src/services/job-worker');
    const result = await worker.processNextJob();
    expect(result).toBe(false);
  });

  test('failed job is not immediately re-dequeued (backoff)', async () => {
    jobQueue.enqueue('download', { artist: 'Fail', album: 'Test' }, { priority: 0 });
    const worker = require('../../src/services/job-worker');
    worker.setProcessor(async () => { throw new Error('download failed'); });
    await worker.processNextJob();
    // Job should be pending but with retry_after in the future
    const job = jobQueue.getByStatus('pending')[0];
    expect(job).toBeDefined();
    expect(job.retries).toBe(1);
    // Immediate dequeue should skip it (retry_after not reached)
    const nextJob = jobQueue.dequeue();
    expect(nextJob).toBeNull();
  });

  test('job_log entry created on completion', async () => {
    jobQueue.enqueue('download', { artist: 'Log', album: 'Test' }, { priority: 0 });
    const worker = require('../../src/services/job-worker');
    worker.setProcessor(async () => ({ quality: 'flac' }));
    await worker.processNextJob();
    const logs = db.getJobLogs(10);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].outcome).toBe('success');
    expect(logs[0].quality).toBe('flac');
  });

  test('job_log entry created on failure with reason', async () => {
    jobQueue.enqueue('download', { artist: 'Err', album: 'Test' }, { priority: 0 });
    const worker = require('../../src/services/job-worker');
    worker.setProcessor(async () => { throw new Error('RD API timeout'); });
    await worker.processNextJob();
    const logs = db.getJobLogs(10);
    const failLog = logs.find(l => l.outcome === 'failed');
    expect(failLog).toBeDefined();
    expect(failLog.fail_reason).toContain('RD API timeout');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest --testPathPatterns="job-worker" --no-coverage`

- [ ] **Step 4: Implement the worker**

Create `packages/server/src/services/job-worker.js`:

```javascript
const jobQueue = require('./job-queue');
const db = require('./db');
const logger = require('./logger');

const POLL_INTERVAL = 5000; // 5 seconds
const BACKOFF = [60000, 300000, 900000]; // 1min, 5min, 15min
const JOB_TIMEOUT = 600000; // 10 minutes

let running = false;
let pollTimer = null;

// Process a single job — override with setProcessor()
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

  // Backoff check: skip jobs that are retrying and haven't reached their retry_after time
  // (retry_after is set by fail() — see below)
  if (job.retry_after && Date.now() < job.retry_after) {
    // Put it back — not ready yet
    return false;
  }

  const start = Date.now();
  let timeoutTimer;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutTimer = setTimeout(() => reject(new Error('Job timeout exceeded')), JOB_TIMEOUT);
    });
    const result = await Promise.race([processor(job), timeoutPromise]);
    clearTimeout(timeoutTimer);
    const duration = Date.now() - start;

    jobQueue.complete(job.id, result || {});  // pass raw object, not pre-stringified
    db.addJobLog({
      job_id: job.id,
      artist: payload.artist,
      album: payload.album,
      attempt: job.retries + 1,
      duration_ms: duration,
      outcome: 'success',
      fail_reason: null,
      quality: result?.quality || null,
    });
    return true;
  } catch (err) {
    clearTimeout(timeoutTimer);
    const duration = Date.now() - start;

    // Set retry_after based on backoff schedule
    const retryAfter = Date.now() + (BACKOFF[job.retries] || BACKOFF[BACKOFF.length - 1]);
    jobQueue.fail(job.id, err.message, retryAfter);
    db.addJobLog({
      job_id: job.id,
      artist: payload.artist,
      album: payload.album,
      attempt: job.retries + 1,
      duration_ms: duration,
      outcome: duration >= JOB_TIMEOUT ? 'timeout' : 'failed',
      fail_reason: err.message,
      quality: null,
    });
    return true; // still processed (even though failed)
  }
}

function start() {
  if (running) return;
  running = true;
  poll();
}

function stop() {
  running = false;
  if (pollTimer) clearTimeout(pollTimer);
}

async function poll() {
  if (!running) return;
  try {
    const processed = await processNextJob();
    // If we processed a job, immediately check for more
    // Otherwise, wait POLL_INTERVAL before checking again
    pollTimer = setTimeout(poll, processed ? 0 : POLL_INTERVAL);
  } catch (err) {
    logger.error('[job-worker] poll error:', err.message);
    pollTimer = setTimeout(poll, POLL_INTERVAL);
  }
}

module.exports = { start, stop, processNextJob, setProcessor };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest --testPathPatterns="job-worker" --no-coverage`

- [ ] **Step 6: Wire worker into server startup**

In `packages/server/src/index.js`, after existing initialization:

```javascript
const jobWorker = require('./services/job-worker');
const pipeline = require('./services/pipeline');

// Register the download processor
jobWorker.setProcessor(async (job) => {
  const payload = JSON.parse(job.payload);
  // delegate to existing pipeline download logic
  return pipeline.processJob(payload);
});

jobWorker.start();
```

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/job-worker.js packages/server/src/services/db.js packages/server/src/index.js packages/server/__tests__/services/job-worker.test.js
git commit -m "feat: add job queue worker with polling, logging, and timeout"
```

---

### Task 2: Download Timeouts and Stall Detection

**Context:** `downloader.js` `downloadFile()` has no timeout. `realdebrid.js` `rdFetch()` has no timeout. Add AbortSignal-based timeouts.

**Files:**
- Modify: `packages/server/src/services/downloader.js` (lines 22-56, `downloadFile`)
- Modify: `packages/server/src/services/realdebrid.js` (`rdFetch` function)
- Create: `packages/server/__tests__/services/download-timeout.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
describe('download timeouts', () => {
  test('downloadFile aborts after 60s inactivity', () => {
    // mock a stalled stream, verify AbortError
  });

  test('rdFetch aborts after 30s', () => {
    // mock slow RD API, verify timeout
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Add stall detection to downloadFile**

In `downloader.js`, modify `downloadFile()` to use an inactivity timer:

```javascript
async function downloadFile(url, destPath, { inactivityTimeout = 60000 } = {}) {
  const response = await fetch(url);
  // ... existing setup ...

  let inactivityTimer;
  const resetTimer = () => {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      reader.cancel('Download stalled — no bytes received for 60s');
    }, inactivityTimeout);
  };

  resetTimer();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    resetTimer();
    // ... existing write logic ...
  }
  clearTimeout(inactivityTimer);
}
```

- [ ] **Step 4: Add timeout to rdFetch**

In `realdebrid.js`, add `AbortSignal.timeout(30000)` to all fetch calls:

```javascript
async function rdFetch(endpoint, options = {}) {
  const signal = AbortSignal.timeout(30000);
  const response = await fetch(url, { ...options, signal });
  // ... existing logic ...
}
```

- [ ] **Step 5: Run tests to verify they pass**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: add download stall detection (60s) and RD API timeout (30s)"
```

---

### Task 3: No-Dupes Rule

**Context:** Before downloading, check if album already exists on disk at `$MUSIC_DIR`. The library scan logic lives in `packages/server/src/api/library.js` (`scanMusicDir()`).

**Files:**
- Create: `packages/server/src/services/library-check.js`
- Create: `packages/server/__tests__/services/library-check.test.js`
- Modify: `packages/server/src/services/job-worker.js` (add pre-check)

- [ ] **Step 1: Write failing tests**

```javascript
describe('library-check', () => {
  test('albumExistsInLibrary returns true when folder has audio files', () => {
    // create temp dir with .flac files, verify detection
  });

  test('albumExistsInLibrary returns false for empty folder', () => {
    // create empty dir, verify false
  });

  test('normalizeForComparison handles case and special chars', () => {
    expect(normalize('Heilung')).toBe('heilung');
    expect(normalize('AC/DC')).toBe('acdc');
    expect(normalize("Guns N' Roses")).toBe('gunsnroses');
  });

  test('findMatchingAlbum finds near-matches', () => {
    // "The Beatles" + "Abbey Road" matches "Beatles" + "Abbey Road"
  });
});
```

- [ ] **Step 2: Implement library-check.js**

```javascript
const fs = require('fs');
const path = require('path');

const MUSIC_DIR = process.env.MUSIC_DIR || '/app/music';
const AUDIO_EXT = new Set(['.mp3', '.flac', '.ogg', '.m4a', '.aac', '.wav', '.opus']);

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function albumExistsInLibrary(artist, album) {
  const normArtist = normalize(artist);
  const normAlbum = normalize(album);

  if (!fs.existsSync(MUSIC_DIR)) return false;

  for (const artistDir of fs.readdirSync(MUSIC_DIR)) {
    if (normalize(artistDir) !== normArtist) continue;
    const artistPath = path.join(MUSIC_DIR, artistDir);
    if (!fs.statSync(artistPath).isDirectory()) continue;

    for (const albumDir of fs.readdirSync(artistPath)) {
      if (normalize(albumDir) !== normAlbum) continue;
      const albumPath = path.join(artistPath, albumDir);
      if (!fs.statSync(albumPath).isDirectory()) continue;

      // Check for at least one audio file
      const files = fs.readdirSync(albumPath);
      if (files.some(f => AUDIO_EXT.has(path.extname(f).toLowerCase()))) {
        return true;
      }
    }
  }
  return false;
}

function getExistingQuality(artist, album) {
  // Returns the quality of existing files, or null if not found
  // Used by no-downgrade check (Task 4)
}

module.exports = { albumExistsInLibrary, getExistingQuality, normalize };
```

- [ ] **Step 3: Integrate into job-worker.js**

In the `processNextJob` function, add a pre-check before calling the processor:

```javascript
const { albumExistsInLibrary } = require('./library-check');

// Inside processNextJob, before calling processor:
const payload = JSON.parse(job.payload);
if (albumExistsInLibrary(payload.artist, payload.album)) {
  jobQueue.complete(job.id, JSON.stringify({ skipped: 'duplicate' }));
  db.addJobLog({ ...logEntry, outcome: 'skipped_duplicate' });
  return true;
}
```

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add no-dupes rule — skip downloads for albums already in library"
```

---

### Task 4: No-Downgrade Rule

**Context:** Use ffprobe (already in `file-validator.js`) to detect quality of existing files. Compare against incoming source quality from `job.payload.source_meta.quality`.

**Files:**
- Modify: `packages/server/src/services/library-check.js` (implement `getExistingQuality`)
- Create: `packages/server/__tests__/services/quality-compare.test.js`
- Modify: `packages/server/src/services/job-worker.js` (add quality check)

- [ ] **Step 1: Write failing tests**

```javascript
describe('quality comparison', () => {
  test('QUALITY_RANK orders correctly', () => {
    expect(rank('flac')).toBeGreaterThan(rank('320'));
    expect(rank('320')).toBeGreaterThan(rank('v0'));
    expect(rank('v0')).toBeGreaterThan(rank('mp3'));
    expect(rank('unknown')).toBe(0);
  });

  test('isUpgrade returns true for mp3 -> flac', () => {
    expect(isUpgrade('mp3', 'flac')).toBe(true);
  });

  test('isUpgrade returns false for flac -> mp3', () => {
    expect(isUpgrade('flac', 'mp3')).toBe(false);
  });

  test('isUpgrade returns false for same quality', () => {
    expect(isUpgrade('320', '320')).toBe(false);
  });

  test('unknown existing + known incoming = upgrade', () => {
    expect(isUpgrade('unknown', 'flac')).toBe(true);
  });

  test('unknown to unknown is not an upgrade', () => {
    expect(isUpgrade('unknown', 'unknown')).toBe(false);
  });
});
```

- [ ] **Step 2: Implement quality detection and comparison**

In `library-check.js`, add:

```javascript
const { execSync } = require('child_process');

const QUALITY_RANK = { flac: 6, '320': 5, v0: 4, '256': 3, '192': 2, '128': 1, unknown: 0 };

function detectFileQuality(filePath) {
  try {
    const out = execSync(
      `ffprobe -v quiet -print_format json -show_format "${filePath}"`,
      { timeout: 5000 }
    );
    const info = JSON.parse(out);
    const codec = info.format?.format_name || '';
    const bitrate = parseInt(info.format?.bit_rate || '0', 10);

    if (codec.includes('flac')) return 'flac';
    if (bitrate >= 310000) return '320';
    if (bitrate >= 245000) return '256';
    if (bitrate >= 220000) return 'v0';
    if (bitrate >= 185000) return '192';
    if (bitrate >= 120000) return '128';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function getExistingQuality(artist, album) {
  // Find the album dir, pick the first audio file, detect its quality
  // Returns quality string or null if album not found
}

function isUpgrade(existingQuality, incomingQuality) {
  const existingRank = QUALITY_RANK[existingQuality] ?? 0;
  const incomingRank = QUALITY_RANK[incomingQuality] ?? 0;
  return incomingRank > existingRank;
}

module.exports = { ..., detectFileQuality, isUpgrade, QUALITY_RANK };
```

- [ ] **Step 3: Integrate into job-worker.js**

After the dupe check, before calling processor:

```javascript
const { getExistingQuality, isUpgrade } = require('./library-check');

const existingQuality = getExistingQuality(payload.artist, payload.album);
if (existingQuality !== null) {
  const incomingQuality = payload.source_meta?.quality || 'unknown';
  if (!isUpgrade(existingQuality, incomingQuality)) {
    jobQueue.complete(job.id, JSON.stringify({ skipped: 'no_upgrade' }));
    db.addJobLog({ ...logEntry, outcome: 'skipped_no_upgrade' });
    return true;
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add no-downgrade rule — only replace if incoming quality is strictly higher"
```

---

## Phase B: Search Performance

### Task 5: Server-Side Search Speed (parallelize + cache)

**Context:** In `packages/server/src/api/search.js`, joined-query search (lines 374-396) and fuzzy search (lines 399-416) run sequentially. In `packages/server/src/services/search.js`, ApiBay results are not cached.

**Files:**
- Modify: `packages/server/src/api/search.js` (lines 361-416)
- Modify: `packages/server/src/services/search.js` (add cache)
- Modify: `packages/server/__tests__/api/search.test.js` (add timing assertion)

- [ ] **Step 1: Add cache to ApiBay search**

In `search.js` (the service, not the API), add an in-memory cache with 10-minute TTL:

```javascript
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000;

async function searchMusic(query) {
  const cacheKey = `torrent:${query.toLowerCase().trim()}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.data;

  // ... existing fetch logic ...

  cache.set(cacheKey, { data: results, expires: Date.now() + CACHE_TTL });
  return results;
}
```

- [ ] **Step 2: Parallelize multi-strategy search**

In `search.js` (the API), replace the sequential joined + fuzzy block (lines ~374-416) with:

```javascript
// Fire joined and fuzzy searches in parallel
const [joinedResults, fuzzyResults] = await Promise.allSettled([
  (async () => {
    if (queryWords.length < 2 || topArtistScore >= 95) return null;
    const joinedQuery = queryWords.join('');
    return searchArtists(joinedQuery);
  })(),
  (async () => {
    if (mbReleases.length > 0 && topArtistScore >= 80) return null;
    return Promise.all([searchReleasesFuzzy(mbQuery), searchArtistsFuzzy(mbQuery)]);
  })(),
]);

// Merge joined results if they improved things
if (joinedResults.status === 'fulfilled' && joinedResults.value) {
  // ... existing merge logic ...
}

// Merge fuzzy results
if (fuzzyResults.status === 'fulfilled' && fuzzyResults.value) {
  const [fuzzyReleases, fuzzyArtists] = fuzzyResults.value;
  // ... existing merge logic ...
}
```

- [ ] **Step 3: Write test verifying parallel behavior**

```javascript
test('joined and fuzzy searches fire in parallel', async () => {
  // Mock both to take 500ms each
  // Total should be ~500ms, not ~1000ms
});
```

- [ ] **Step 4: Run all search tests**

Run: `npx jest --testPathPatterns="search" --no-coverage`

- [ ] **Step 5: Commit**

```bash
git commit -m "perf: parallelize multi-strategy search and cache ApiBay results (10min TTL)"
```

---

### Task 6: Client-Side Search Speed

**Context:** `useMoreByArtist.js` re-searches for artists already in results (lines 12-20). `useArtistPage.js` awaits `getArtist()` before other fetches (lines 20-36).

**Files:**
- Modify: `packages/client/src/hooks/useMoreByArtist.js`
- Modify: `packages/client/src/hooks/useArtistPage.js`

- [ ] **Step 1: Fix useMoreByArtist redundant search**

Replace the search fallback (lines 12-20) to use cached artist from initial search results:

```javascript
// Before: searched again for the artist
// After: use searchArtistResults directly, only fetch discography
useEffect(() => {
  if (view !== 'album' || !selectedAlbum?.artist) return;

  // Find artist MBID from cached search results first
  const cachedArtist = searchArtistResults?.find(a =>
    a.name.toLowerCase() === selectedAlbum.artist.toLowerCase()
  );

  if (cachedArtist?.mbid) {
    api.getArtist(cachedArtist.mbid, cachedArtist.name).then(setReleases);
  }
  // No fallback search — if not cached, skip "more by artist"
}, [view, selectedAlbum?.artist]);
```

- [ ] **Step 2: Parallelize useArtistPage loads**

Replace sequential awaits (lines 20-36) with `Promise.all`:

```javascript
const [artistData, topTracks] = await Promise.all([
  api.getArtist(mbid, name),
  api.getLastfmTopTracks(name).catch(() => []),
]);

setArtistReleases(artistData.releases || []);
setArtistDetails(artistData.details || {});
setArtistTopTracks(topTracks);

// Wiki fetch can still be conditional on artistData
if (artistData.details?.wikiLink) {
  api.getWikiSummary(artistData.details.wikiLink).then(setArtistBio);
}
```

- [ ] **Step 3: Verify in dev** (manual — Vite HMR)

- [ ] **Step 4: Commit**

```bash
git commit -m "perf: eliminate redundant artist search and parallelize artist page loads"
```

---

### Task 7: Prefetch Track Listings

**Context:** `useMbTracks.js` lazy-loads tracks only after album is selected. We want to prefetch on hover and when clicking into an artist's discography.

**Files:**
- Modify: `packages/client/src/hooks/useMbTracks.js`
- Modify: `packages/shared/src/api-client.js` (add prefetch helper)
- Modify: `packages/client/src/components/AlbumCard.jsx` (add onMouseEnter)

- [ ] **Step 1: Add prefetch cache to api-client**

In `api-client.js`, add a simple prefetch mechanism:

```javascript
const prefetchCache = new Map();

export function prefetchMbTracks(mbid, rgid) {
  const key = mbid || rgid;
  if (prefetchCache.has(key)) return;
  const promise = mbid ? getMbReleaseTracks(mbid) : getMbRgTracks(rgid);
  prefetchCache.set(key, promise);
}

export function getCachedMbTracks(key) {
  return prefetchCache.get(key) || null;
}
```

- [ ] **Step 2: Trigger prefetch on album hover**

In `AlbumCard.jsx`, add `onMouseEnter`:

```javascript
onMouseEnter={() => {
  if (album.mbid || album.rgid) {
    api.prefetchMbTracks(album.mbid, album.rgid);
  }
}}
```

- [ ] **Step 3: Use prefetch cache in useMbTracks**

In `useMbTracks.js`, check cache before fetching:

```javascript
const cached = api.getCachedMbTracks(selectedAlbum.mbid || selectedAlbum.rgid);
if (cached) {
  cached.then(tracks => { /* set tracks */ });
} else {
  // existing fetch logic
}
```

- [ ] **Step 4: Add discography prefetch on artist click**

When artist page opens, prefetch track listings for the artist's top albums in the background.

- [ ] **Step 5: Commit**

```bash
git commit -m "perf: prefetch track listings on album hover and artist click"
```

---

## Phase C: Last.fm Scrobble Sync

### Task 8: Scrobble Database Schema

**Files:**
- Modify: `packages/server/src/services/db.js` (add tables + functions)
- Create: `packages/server/__tests__/services/scrobble-db.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
describe('scrobble database', () => {
  test('insertScrobbles bulk inserts and dedupes', () => {
    db.insertScrobbles('nathan', [
      { artist: 'Heilung', album: 'Ofnir', track: 'Alfadhirhaiti', played_at: 1000 },
      { artist: 'Heilung', album: 'Ofnir', track: 'Alfadhirhaiti', played_at: 1000 }, // dupe
    ]);
    const count = db.getScrobbleCount('nathan');
    expect(count).toBe(1);
  });

  test('rebuildArtistAffinity aggregates correctly', () => {
    db.insertScrobbles('nathan', [
      { artist: 'Heilung', album: 'Ofnir', track: 'Track1', played_at: 1000 },
      { artist: 'Heilung', album: 'Ofnir', track: 'Track2', played_at: 2000 },
      { artist: 'Wardruna', album: 'Runaljod', track: 'Track1', played_at: 3000 },
    ]);
    db.rebuildArtistAffinity('nathan');
    const affinity = db.getArtistAffinity('nathan');
    expect(affinity).toHaveLength(2);
    const heilung = affinity.find(a => a.artist === 'Heilung');
    expect(heilung.play_count).toBe(2);
    expect(heilung.last_played_at).toBe(2000);
  });

  test('getUniqueAlbumsSince returns albums in time window', () => {
    const now = Math.floor(Date.now() / 1000);
    db.insertScrobbles('nathan', [
      { artist: 'A', album: 'Old', track: 'T', played_at: now - 200 * 86400 },
      { artist: 'B', album: 'Recent', track: 'T', played_at: now - 30 * 86400 },
    ]);
    const albums = db.getUniqueAlbumsSince('nathan', 60);
    expect(albums).toHaveLength(1);
    expect(albums[0].artist).toBe('B');
  });

  test('getAffinityForArtist returns match for prefix search', () => {
    db.rebuildArtistAffinity('nathan');
    const matches = db.searchArtistAffinity('nathan', 'heil');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].artist).toBe('Heilung');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Add schema and functions to db.js**

Add tables:

```sql
CREATE TABLE IF NOT EXISTS scrobbles (
  user_id TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  track TEXT NOT NULL,
  played_at INTEGER NOT NULL,
  UNIQUE(user_id, artist, track, played_at)
);
CREATE INDEX IF NOT EXISTS idx_scrobbles_user_artist ON scrobbles(user_id, artist);
CREATE INDEX IF NOT EXISTS idx_scrobbles_user_time ON scrobbles(user_id, played_at);

CREATE TABLE IF NOT EXISTS artist_affinity (
  user_id TEXT NOT NULL,
  artist TEXT NOT NULL,
  play_count INTEGER NOT NULL,
  last_played_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, artist)
);
```

Add functions:

```javascript
function insertScrobbles(userId, scrobbles) {
  const stmt = getDb().prepare(
    'INSERT OR IGNORE INTO scrobbles (user_id, artist, album, track, played_at) VALUES (?, ?, ?, ?, ?)'
  );
  const tx = getDb().transaction(() => {
    for (const s of scrobbles) {
      stmt.run(userId, s.artist, s.album || '', s.track, s.played_at);
    }
  });
  tx();
}

function getScrobbleCount(userId) {
  return getDb().prepare('SELECT COUNT(*) as count FROM scrobbles WHERE user_id = ?').get(userId).count;
}

function rebuildArtistAffinity(userId) {
  getDb().prepare('DELETE FROM artist_affinity WHERE user_id = ?').run(userId);
  getDb().prepare(`
    INSERT INTO artist_affinity (user_id, artist, play_count, last_played_at)
    SELECT user_id, artist, COUNT(*) as play_count, MAX(played_at) as last_played_at
    FROM scrobbles WHERE user_id = ? GROUP BY user_id, artist
  `).run(userId);
}

function getArtistAffinity(userId) {
  return getDb().prepare('SELECT * FROM artist_affinity WHERE user_id = ? ORDER BY play_count DESC').all(userId);
}

function getUniqueAlbumsSince(userId, days) {
  const since = Math.floor(Date.now() / 1000) - (days * 86400);
  return getDb().prepare(`
    SELECT DISTINCT artist, album FROM scrobbles
    WHERE user_id = ? AND played_at >= ? AND album != ''
    ORDER BY artist, album
  `).all(userId, since);
}

function searchArtistAffinity(userId, query) {
  const pattern = `%${query}%`;
  return getDb().prepare(`
    SELECT * FROM artist_affinity
    WHERE user_id = ? AND artist LIKE ? AND play_count >= 2
    ORDER BY play_count DESC LIMIT 3
  `).all(userId, pattern);
}
```

Export all new functions.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add scrobbles and artist_affinity tables with query functions"
```

---

### Task 9: Scrobble Sync Service

**Files:**
- Create: `packages/server/src/services/scrobble-sync.js`
- Create: `packages/server/__tests__/services/scrobble-sync.test.js`
- Modify: `packages/server/src/services/lastfm.js` (add `getRecentTracksPage` for pagination)
- Modify: `packages/server/src/index.js` (start delta sync interval)

- [ ] **Step 1: Add paginated getRecentTracks to lastfm.js**

The existing `getRecentTracks` is cached and limited. Add an uncached paginated version:

```javascript
async function getRecentTracksPage(user, page = 1, limit = 200, from = null) {
  await rateLimit();
  const params = new URLSearchParams({
    method: 'user.getrecenttracks', user, api_key: apiKey,
    format: 'json', limit: String(limit), page: String(page),
  });
  if (from) params.set('from', String(from));
  const response = await fetch(`${BASE_URL}?${params}`);
  if (!response.ok) throw new Error(`Last.fm API ${response.status}`);
  const data = await response.json();
  return {
    tracks: data.recenttracks?.track || [],
    totalPages: parseInt(data.recenttracks?.['@attr']?.totalPages || '1', 10),
    total: parseInt(data.recenttracks?.['@attr']?.total || '0', 10),
  };
}
```

Export it.

- [ ] **Step 2: Write failing tests for sync service**

```javascript
jest.mock('../../src/services/lastfm');
const lastfm = require('../../src/services/lastfm');

describe('scrobble-sync', () => {
  test('fullSync pages through all scrobbles', async () => {
    lastfm.getRecentTracksPage
      .mockResolvedValueOnce({ tracks: [mockTrack('A', 'B', 'T', 1000)], totalPages: 2, total: 2 })
      .mockResolvedValueOnce({ tracks: [mockTrack('C', 'D', 'T', 2000)], totalPages: 2, total: 2 });

    const result = await sync.fullSync('nathan', 'lastfmuser');
    expect(result.fetched).toBe(2);
    expect(db.getScrobbleCount('nathan')).toBe(2);
  });

  test('deltaSync fetches only since lastSyncedAt', async () => {
    // set lastSyncedAt, verify 'from' param passed
  });

  test('fullSync updates progress in user_settings', async () => {
    // verify user_settings has sync state during and after
  });
});
```

- [ ] **Step 3: Implement scrobble-sync.js**

```javascript
const lastfm = require('./lastfm');
const db = require('./db');
const logger = require('./logger');

async function fullSync(userId, lastfmUsername) {
  const startedAt = Date.now();
  db.setUserSetting(userId, 'scrobbleSync', JSON.stringify({
    state: 'syncing', total: 0, fetched: 0, startedAt
  }));

  let page = 1;
  let totalPages = 1;
  let fetched = 0;

  while (page <= totalPages) {
    let result;
    try {
      result = await lastfm.getRecentTracksPage(lastfmUsername, page, 200);
    } catch (err) {
      // Handle HTTP 429 rate limiting — back off 30 seconds and retry
      if (err.message?.includes('429')) {
        logger.warn(`[scrobble-sync] Rate limited, backing off 30s (page ${page})`);
        await new Promise(r => setTimeout(r, 30000));
        continue; // retry same page
      }
      throw err;
    }
    totalPages = result.totalPages;

    const scrobbles = result.tracks
      .filter(t => t.date) // skip "now playing" (no date)
      .map(t => ({
        artist: t.artist?.['#text'] || t.artist?.name || '',
        album: t.album?.['#text'] || '',
        track: t.name || '',
        played_at: parseInt(t.date?.uts || '0', 10),
      }));

    db.insertScrobbles(userId, scrobbles);
    fetched += scrobbles.length;

    db.setUserSetting(userId, 'scrobbleSync', JSON.stringify({
      state: 'syncing', total: result.total, fetched, startedAt
    }));

    page++;
  }

  db.rebuildArtistAffinity(userId);
  db.setUserSetting(userId, 'scrobbleSync', JSON.stringify({
    state: 'complete', total: fetched, lastSyncedAt: Math.floor(Date.now() / 1000)
  }));

  logger.info(`[scrobble-sync] Full sync complete for ${userId}: ${fetched} scrobbles`);
  return { fetched };
}

async function deltaSync(userId, lastfmUsername) {
  const syncState = JSON.parse(db.getUserSetting(userId, 'scrobbleSync') || '{}');
  const from = syncState.lastSyncedAt || 0;
  if (!from) return fullSync(userId, lastfmUsername);

  let page = 1;
  let totalPages = 1;
  let fetched = 0;

  while (page <= totalPages) {
    const result = await lastfm.getRecentTracksPage(lastfmUsername, page, 200, from);
    totalPages = result.totalPages;

    const scrobbles = result.tracks
      .filter(t => t.date)
      .map(t => ({
        artist: t.artist?.['#text'] || t.artist?.name || '',
        album: t.album?.['#text'] || '',
        track: t.name || '',
        played_at: parseInt(t.date?.uts || '0', 10),
      }));

    db.insertScrobbles(userId, scrobbles);
    fetched += scrobbles.length;
    page++;
  }

  // Incremental affinity update for delta
  db.rebuildArtistAffinity(userId);
  db.setUserSetting(userId, 'scrobbleSync', JSON.stringify({
    state: 'complete', total: (syncState.total || 0) + fetched,
    lastSyncedAt: Math.floor(Date.now() / 1000)
  }));

  logger.info(`[scrobble-sync] Delta sync for ${userId}: ${fetched} new scrobbles`);
  return { fetched };
}

// Start delta sync intervals for all authenticated users
const DELTA_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
const intervals = new Map();

function startDeltaSyncScheduler() {
  // Find all users with Last.fm session keys
  const users = db.getUsers();
  for (const user of users) {
    const config = db.getLastfmConfig(user.id);
    if (config?.session_key && config?.username) {
      scheduleDeltaSync(user.id, config.username);
    }
  }
}

function scheduleDeltaSync(userId, lastfmUsername) {
  if (intervals.has(userId)) return;
  const timer = setInterval(() => {
    deltaSync(userId, lastfmUsername).catch(err =>
      logger.error(`[scrobble-sync] Delta sync failed for ${userId}:`, err.message)
    );
  }, DELTA_INTERVAL);
  intervals.set(userId, timer);
}

function stopAll() {
  for (const timer of intervals.values()) clearInterval(timer);
  intervals.clear();
}

module.exports = { fullSync, deltaSync, startDeltaSyncScheduler, scheduleDeltaSync, stopAll };
```

- [ ] **Step 4: Wire into server startup and Last.fm auth flow**

In `index.js`:
```javascript
const scrobbleSync = require('./services/scrobble-sync');
scrobbleSync.startDeltaSyncScheduler();
```

In the Last.fm auth completion endpoint (or `lastfm.js`), trigger full sync after auth:
```javascript
// After session key is saved:
scrobbleSync.fullSync(userId, username).catch(err =>
  logger.error('[scrobble-sync] Initial sync failed:', err.message)
);
scrobbleSync.scheduleDeltaSync(userId, username);
```

- [ ] **Step 5: Add API endpoints for sync status and manual trigger**

In a new or existing API file, add:

```javascript
// GET /api/lastfm/sync/status
router.get('/sync/status', (req, res) => {
  const state = db.getUserSetting(req.userId, 'scrobbleSync');
  res.json(JSON.parse(state || '{ "state": "not_started" }'));
});

// POST /api/lastfm/sync — manual delta sync trigger
router.post('/sync', async (req, res) => {
  const config = db.getLastfmConfig(req.userId);
  if (!config?.session_key) return res.status(400).json({ error: 'Last.fm not connected' });
  // fire and forget
  scrobbleSync.deltaSync(req.userId, config.username).catch(() => {});
  res.json({ started: true });
});
```

- [ ] **Step 6: Run tests, verify pass**

- [ ] **Step 7: Commit**

```bash
git commit -m "feat: add Last.fm scrobble sync — full history + 6-hour delta sync"
```

---

### Task 10: Scrobble Sync UI

**Files:**
- Modify: `packages/client/src/components/SettingsModal.jsx` (Last.fm section)
- Modify: `packages/shared/src/api-client.js` (add sync endpoints)

- [ ] **Step 1: Add API client methods**

```javascript
export function getScrobbleSyncStatus() { return get('/api/lastfm/sync/status'); }
export function triggerScrobbleSync() { return post('/api/lastfm/sync'); }
```

- [ ] **Step 2: Add sync status UI to SettingsModal**

In the Last.fm section of SettingsModal, after the auth section (around line 169), add:

```jsx
{/* Scrobble sync status — only show when authenticated */}
{lastfmStatus?.authenticated && syncStatus && (
  <div style={{ marginTop: 12, fontSize: 13, color: COLORS.textSecondary }}>
    {syncStatus.state === 'syncing' && (
      <span>Syncing Last.fm history... {syncStatus.fetched?.toLocaleString()} / {syncStatus.total?.toLocaleString()} scrobbles</span>
    )}
    {syncStatus.state === 'complete' && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>Last synced: {formatTimeAgo(syncStatus.lastSyncedAt)}</span>
        <button onClick={onSyncNow} style={{ /* small button styles */ }}>
          Sync Now
        </button>
      </div>
    )}
    {syncStatus.state === 'not_started' && (
      <span>Scrobble sync will start automatically...</span>
    )}
  </div>
)}
```

Props needed: `syncStatus`, `onSyncNow`. These should be wired from App.jsx using a polling useEffect for sync status.

- [ ] **Step 3: Wire sync status polling in App.jsx**

Add a useEffect that polls `/api/lastfm/sync/status` every 5 seconds while syncing, every 60 seconds otherwise. Pass `syncStatus` and `onSyncNow` to SettingsModal.

- [ ] **Step 4: Verify in dev**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add scrobble sync progress and Sync Now button to Settings"
```

---

## Phase D: Personalized Search Ranking

### Task 11: Relevance Score and Personal Boost

**Context:** Current search results are sorted by seeders. We need to introduce a composite relevance score and apply the personal boost formula.

**Files:**
- Modify: `packages/server/src/api/search.js` (scoring + re-ranking)
- Create: `packages/server/src/services/search-ranking.js`
- Create: `packages/server/__tests__/services/search-ranking.test.js`

- [ ] **Step 1: Write failing tests for ranking**

```javascript
describe('search-ranking', () => {
  test('computeRelevanceScore combines text, source, popularity', () => {
    const score = computeRelevanceScore({
      textMatch: 0.9, quality: 'flac', seeders: 50, maxSeeders: 100
    });
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  test('computePersonalBoost returns 0 for unknown artist', () => {
    expect(computePersonalBoost(null)).toBe(0);
  });

  test('computePersonalBoost caps at 0.3', () => {
    const boost = computePersonalBoost({ play_count: 10000, last_played_at: now });
    expect(boost).toBe(0.3);
  });

  test('computePersonalBoost requires min 2 plays', () => {
    const boost = computePersonalBoost({ play_count: 1, last_played_at: now });
    expect(boost).toBe(0);
  });

  test('computePersonalBoost decays over 90 days', () => {
    const recent = computePersonalBoost({ play_count: 10, last_played_at: now });
    const old = computePersonalBoost({ play_count: 10, last_played_at: now - 90 * 86400 });
    expect(recent).toBeGreaterThan(old);
  });
});
```

- [ ] **Step 2: Implement search-ranking.js**

```javascript
const QUALITY_SCORES = { flac: 1.0, '320': 0.8, v0: 0.7, '256': 0.5, mp3: 0.3, unknown: 0.1 };
const MAX_BOOST = 0.3;
const WEIGHT = 0.1;
const HALF_LIFE_DAYS = 90;
const MIN_PLAYS = 2;

function computeRelevanceScore({ textMatch = 0, quality = 'unknown', seeders = 0, maxSeeders = 1 }) {
  const sourceScore = QUALITY_SCORES[quality] || 0.1;
  const popularity = maxSeeders > 0 ? Math.log(1 + seeders) / Math.log(1 + maxSeeders) : 0;
  return (textMatch * 0.5) + (sourceScore * 0.3) + (popularity * 0.2);
}

function computePersonalBoost(affinity) {
  if (!affinity || affinity.play_count < MIN_PLAYS) return 0;
  const daysSince = (Date.now() / 1000 - affinity.last_played_at) / 86400;
  const decay = 1 / (1 + daysSince / HALF_LIFE_DAYS);
  return Math.min(MAX_BOOST, WEIGHT * Math.log2(1 + affinity.play_count) * decay);
}

function rankResults(results, affinityMap) {
  const maxSeeders = Math.max(1, ...results.map(r => r.bestSeeders || 0));

  return results.map(r => {
    const relevance = computeRelevanceScore({
      textMatch: r.matchScore || 0.5,
      quality: r.bestQuality || 'unknown',
      seeders: r.bestSeeders || 0,
      maxSeeders,
    });
    const affinity = affinityMap.get((r.artist || '').toLowerCase());
    const boost = computePersonalBoost(affinity);
    return { ...r, _relevance: relevance, _boost: boost, _finalScore: relevance * (1 + boost) };
  }).sort((a, b) => b._finalScore - a._finalScore);
}

module.exports = { computeRelevanceScore, computePersonalBoost, rankResults };
```

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add relevance scoring and personal boost ranking engine"
```

---

### Task 12: History Injection and Search Integration

**Files:**
- Modify: `packages/server/src/api/search.js` (integrate ranking + injection)
- Modify: `packages/server/__tests__/api/search.test.js`

- [ ] **Step 1: Add history injection logic to search-ranking.js**

```javascript
function getHistoryInjections(userId, query, existingArtists) {
  const db = require('./db');
  const matches = db.searchArtistAffinity(userId, query);
  const existingSet = new Set(existingArtists.map(a => a.toLowerCase()));

  return matches
    .filter(m => !existingSet.has(m.artist.toLowerCase()))
    .slice(0, 3)
    .map(m => ({
      artist: m.artist,
      album: null, // stub — sources load on click
      sources: [],
      matchScore: 0.6, // reasonable text match for substring hit
    }));
}
```

- [ ] **Step 2: Integrate into search endpoint**

In `search.js` GET `/api/search`, after results are assembled but before returning:

```javascript
// Personalized ranking (if user has affinity data)
const { rankResults, getHistoryInjections } = require('../services/search-ranking');

if (req.userId) {
  const affinityRows = db.getArtistAffinity(req.userId);
  const affinityMap = new Map(affinityRows.map(a => [a.artist.toLowerCase(), a]));

  // Inject history matches not in results
  const injections = getHistoryInjections(req.userId, q, albums.map(a => a.artist));
  albums.push(...injections);

  // Rank all results
  albums = rankResults(albums, affinityMap);
}
```

- [ ] **Step 3: Write integration test**

```javascript
test('search results include history-injected artist', async () => {
  // Setup: add scrobbles for "Kiki Rockwell", rebuild affinity
  // Search for "kiki" — verify Kiki Rockwell appears in results
});
```

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: personalized search ranking with history injection"
```

---

## Phase E: Library Import from Last.fm

### Task 13: Import Endpoint

**Files:**
- Modify: `packages/server/src/api/import.js` (replace existing `/lastfm` endpoint)
- Create: `packages/server/__tests__/api/lastfm-import.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
describe('POST /api/import/lastfm', () => {
  test('returns summary with counts', async () => {
    // Pre-populate scrobbles table with known data
    // POST /api/import/lastfm { days: 60 }
    // Verify response: { found, artists, albums, alreadyInLibrary, alreadyQueued, queued }
  });

  test('rejects when scrobble sync not complete', async () => {
    // Set sync state to 'syncing'
    // POST should return 400
  });

  test('dedupes against library', async () => {
    // Add album to mock MUSIC_DIR, verify it's counted as alreadyInLibrary
  });
});
```

- [ ] **Step 2: Implement the endpoint**

Replace existing `POST /api/import/lastfm` in `import.js`:

```javascript
router.post('/lastfm', async (req, res) => {
  const { days = 60 } = req.body;
  const userId = req.userId;

  // Check sync status
  const syncState = JSON.parse(db.getUserSetting(userId, 'scrobbleSync') || '{}');
  if (syncState.state !== 'complete') {
    return res.status(400).json({ error: 'Scrobble sync not complete yet' });
  }

  // Get unique albums from scrobbles in the time window
  const albums = db.getUniqueAlbumsSince(userId, days);
  const uniqueArtists = new Set(albums.map(a => a.artist));

  let alreadyInLibrary = 0;
  let alreadyQueued = 0;
  let queued = 0;
  let notFound = 0;

  for (const { artist, album } of albums) {
    // Check library
    if (libraryCheck.albumExistsInLibrary(artist, album)) {
      alreadyInLibrary++;
      continue;
    }

    // Check job queue (dedupe)
    const dedupeKey = `${libraryCheck.normalize(artist)}:${libraryCheck.normalize(album)}`;
    const existing = jobQueue.getAll().find(j =>
      j.dedupe_key === dedupeKey && ['pending', 'active'].includes(j.status)
    );
    if (existing) {
      alreadyQueued++;
      continue;
    }

    // Search for sources (rate-limited: MB allows 1 req/sec, built into musicbrainz.js)
    try {
      const searchResult = await searchForAlbum(artist, album);
      if (searchResult) {
        jobQueue.enqueue('download', {
          artist, album,
          magnetLink: searchResult.magnetLink,
          source_meta: { quality: searchResult.quality, seeders: searchResult.seeders },
        }, { priority: 0, dedupeKey }); // priority 0 = background, pass raw object
        queued++;
      } else {
        notFound++;
      }
    } catch {
      notFound++;
    }
  }

  res.json({
    found: albums.length,
    artists: uniqueArtists.size,
    albums: albums.length,
    alreadyInLibrary,
    alreadyQueued,
    queued,
    notFound,
  });
});
```

- [ ] **Step 3: Add helper for album search**

```javascript
async function searchForAlbum(artist, album) {
  // Call internal search logic (reuse from batch-search)
  // Return best source or null
}
```

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: Last.fm library import endpoint — query scrobbles, dedupe, enqueue downloads"
```

---

### Task 14: Import UI

**Files:**
- Modify: `packages/client/src/components/SettingsModal.jsx`
- Modify: `packages/shared/src/api-client.js` (add import endpoint)
- Modify: `packages/client/src/App.jsx` (wire import state)

- [ ] **Step 1: Add API client method**

```javascript
export function importFromLastfm(days = 60) {
  return post('/api/import/lastfm', { days });
}
```

- [ ] **Step 2: Add import UI to SettingsModal**

After the sync status section, add:

```jsx
{/* Library import — only when sync is complete */}
{lastfmStatus?.authenticated && syncStatus?.state === 'complete' && (
  <div style={{ marginTop: 16, padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Import Library from Last.fm</div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <label style={{ fontSize: 13, color: COLORS.textSecondary }}>Last</label>
      <input type="number" value={importDays} onChange={e => setImportDays(e.target.value)}
        style={{ width: 60, padding: '4px 8px', background: '#333', border: '1px solid #555',
          borderRadius: 4, color: '#fff', fontSize: 13 }}
      />
      <label style={{ fontSize: 13, color: COLORS.textSecondary }}>days</label>
    </div>
    <button onClick={handleImport} disabled={importing}
      style={{ padding: '6px 16px', background: COLORS.accent, border: 'none',
        borderRadius: 4, color: '#fff', fontSize: 13, cursor: 'pointer' }}>
      {importing ? 'Importing...' : 'Import'}
    </button>
    {importResult && (
      <div style={{ marginTop: 8, fontSize: 13, color: COLORS.textSecondary }}>
        Found {importResult.found} albums by {importResult.artists} artists.
        {importResult.alreadyInLibrary > 0 && ` ${importResult.alreadyInLibrary} already in library.`}
        {importResult.alreadyQueued > 0 && ` ${importResult.alreadyQueued} already queued.`}
        {importResult.queued > 0 && ` ${importResult.queued} queued for download.`}
        {importResult.notFound > 0 && ` ${importResult.notFound} not found.`}
      </div>
    )}
  </div>
)}

{/* Greyed out message when sync not complete */}
{lastfmStatus?.authenticated && syncStatus?.state !== 'complete' && (
  <div style={{ marginTop: 16, fontSize: 13, color: COLORS.textSecondary, opacity: 0.5 }}>
    Library import available after scrobble sync completes
  </div>
)}
```

- [ ] **Step 3: Wire state in SettingsModal**

Add local state for `importDays`, `importing`, `importResult`. The `handleImport` function calls `api.importFromLastfm(importDays)` and sets the result.

- [ ] **Step 4: Verify in dev**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add Last.fm library import UI with configurable day window"
```

---

## Final: Version Bump

### Task 15: Bump to v1.2.0

**Files:**
- Modify: `package.json` (root)
- Modify: `packages/server/package.json`
- Modify: `packages/client/package.json`
- Modify: `packages/shared/package.json`
- Modify: `packages/desktop/package.json`
- Modify: `packages/desktop/src-tauri/tauri.conf.json`
- Modify: `packages/desktop/src-tauri/Cargo.toml`

- [ ] **Step 1: Update all version fields to 1.2.0**

- [ ] **Step 2: Run all tests**

Run: `npx jest --no-coverage`

- [ ] **Step 3: Commit and tag**

```bash
git commit -m "chore: bump version to 1.2.0"
git tag v1.2.0
```
