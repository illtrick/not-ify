# Canonical Album Detail Endpoint — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `GET /api/album/:id` as the single source of truth for album data, migrate the library entry point to use it, and fix the edition picker so it shows from all entry points.

**Architecture:** Server-side canonical endpoint using existing `getAlbumWithTracks` DB function with multi-format ID resolution (PK → rgid → mbid). Client migrates `openAlbumFromLibrary` to fetch by ID. Edition picker condition simplified.

**Tech Stack:** Node.js (Express), React, SQLite (better-sqlite3), Jest

---

## File Map

| Task | Create | Modify | Test |
|------|--------|--------|------|
| 1 | — | `packages/server/src/services/db.js` | `packages/server/__tests__/services/db-album.test.js` |
| 2 | — | `packages/server/src/api/library.js` | `packages/server/__tests__/api/album-detail.test.js` |
| 3 | — | `packages/shared/src/api-client.js` | — |
| 4 | — | `packages/client/src/App.jsx` | — |
| 5 | — | `packages/client/src/components/AlbumView.jsx` | — |

---

### Task 1: Add `getAlbumByAnyId()` to db.js

**Files:**
- Modify: `packages/server/src/services/db.js:764-778, ~1205`
- Create: `packages/server/__tests__/services/db-album.test.js`

**Context:** Three lookup functions already exist: `getAlbumById` (line 764), `getAlbumByRgid` (line 772), `getAlbumByMbid` (line 776). We need a resolver that chains them with fallback.

- [ ] **Step 1: Write failing test**

```javascript
// packages/server/__tests__/services/db-album.test.js
'use strict';

const db = require('../../src/services/db');

// Ensure DB is initialized for tests
beforeAll(() => { db.getDb(); });

describe('getAlbumByAnyId', () => {
  const testAlbum = {
    id: 'test-album-001',
    title: 'Fear Inoculum',
    album_artist: 'Tool',
    year: 2019,
    track_count: 10,
    duration: 5200,
    mbid: 'mbid-test-001',
    rgid: 'rgid-test-001',
    cover_art_url: '/api/cover/rg/rgid-test-001',
  };

  beforeAll(() => {
    db.getDb().prepare(`
      INSERT OR REPLACE INTO albums (id, title, album_artist, year, track_count, duration, mbid, rgid, cover_art_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(testAlbum.id, testAlbum.title, testAlbum.album_artist, testAlbum.year,
           testAlbum.track_count, testAlbum.duration, testAlbum.mbid, testAlbum.rgid, testAlbum.cover_art_url);
  });

  afterAll(() => {
    db.getDb().prepare('DELETE FROM albums WHERE id = ?').run(testAlbum.id);
  });

  test('resolves by direct album ID', () => {
    const result = db.getAlbumByAnyId('test-album-001');
    expect(result).not.toBeNull();
    expect(result.title).toBe('Fear Inoculum');
  });

  test('resolves by rgid', () => {
    const result = db.getAlbumByAnyId('rgid-test-001');
    expect(result).not.toBeNull();
    expect(result.title).toBe('Fear Inoculum');
  });

  test('resolves by mbid', () => {
    const result = db.getAlbumByAnyId('mbid-test-001');
    expect(result).not.toBeNull();
    expect(result.title).toBe('Fear Inoculum');
  });

  test('returns null for unknown ID', () => {
    const result = db.getAlbumByAnyId('nonexistent-id');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx jest __tests__/services/db-album.test.js --no-cache`
Expected: FAIL — `db.getAlbumByAnyId is not a function`

- [ ] **Step 3: Implement getAlbumByAnyId**

In `packages/server/src/services/db.js`, after `getAlbumByMbid` (line 778), add:

```javascript
function getAlbumByAnyId(id) {
  if (!id) return null;
  return getAlbumById(id) || getAlbumByRgid(id) || getAlbumByMbid(id) || null;
}
```

Add to module.exports (after `getAlbumByMbid` in the exports, ~line 1205):
```javascript
  getAlbumByAnyId,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && npx jest __tests__/services/db-album.test.js --no-cache`
Expected: PASS (4 tests)

- [ ] **Step 5: Run full suite for regressions**

Run: `cd packages/server && npx jest --no-cache 2>&1 | tail -5`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/db.js packages/server/__tests__/services/db-album.test.js
git commit -m "feat: add getAlbumByAnyId with PK → rgid → mbid fallback chain"
```

---

### Task 2: Add `GET /api/album/:id` endpoint

**Files:**
- Modify: `packages/server/src/api/library.js`
- Create: `packages/server/__tests__/api/album-detail.test.js`

**Context:** The `getAlbumWithTracks` DB function (line 929) already does the right JOIN. We need an HTTP endpoint that resolves the ID, fetches the album, and returns a consistent shape. Place it near the existing GET /api/library handler.

- [ ] **Step 1: Write failing test**

```javascript
// packages/server/__tests__/api/album-detail.test.js
'use strict';

const request = require('supertest');
const express = require('express');

// Mock db module
const mockAlbumData = {
  id: 'test-id',
  album_artist: 'Tool',
  title: 'Fear Inoculum',
  year: 2019,
  track_count: 10,
  duration: 5200,
  mbid: 'mbid-123',
  rgid: 'rgid-123',
  cover_art_url: '/api/cover/rg/rgid-123',
  compilation: 0,
  tracks: [
    { id: 'trk1', title: 'Fear Inoculum', artist: 'Tool', trackNumber: 1, discNumber: 1, duration: 622, format: 'flac', filepath: '/app/music/Tool/Fear Inoculum/01.flac', fileSize: 45000000 },
  ],
};

jest.mock('../../src/services/db', () => ({
  getAlbumByAnyId: jest.fn((id) => id === 'test-id' || id === 'rgid-123' ? { id: 'test-id' } : null),
  getAlbumWithTracks: jest.fn((id) => id === 'test-id' ? mockAlbumData : null),
  getDb: jest.fn(),
  isSetupComplete: jest.fn().mockReturnValue(true),
  isValidUser: jest.fn().mockReturnValue(true),
  getDefaultUserId: jest.fn().mockReturnValue('default'),
}));

jest.mock('../../src/services/job-queue', () => ({
  getJobQueue: () => ({ getActiveJobs: () => [], getPendingJobs: () => [] }),
}));

const libraryRouter = require('../../src/api/library');
const app = express();
app.use((req, res, next) => { req.userId = 'default'; next(); });
app.use('/api', libraryRouter);

describe('GET /api/album/:id', () => {
  test('returns album by direct ID', async () => {
    const res = await request(app).get('/api/album/test-id');
    expect(res.status).toBe(200);
    expect(res.body.artist).toBe('Tool');
    expect(res.body.album).toBe('Fear Inoculum');
    expect(res.body.year).toBe(2019);
    expect(res.body.rgid).toBe('rgid-123');
    expect(res.body.inLibrary).toBe(true);
    expect(res.body.tracks).toBeInstanceOf(Array);
    expect(res.body.tracks[0].file).toBeDefined();
  });

  test('returns album by rgid', async () => {
    const res = await request(app).get('/api/album/rgid-123');
    expect(res.status).toBe(200);
    expect(res.body.artist).toBe('Tool');
  });

  test('returns 404 for unknown ID', async () => {
    const res = await request(app).get('/api/album/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx jest __tests__/api/album-detail.test.js --no-cache`
Expected: FAIL — 404 for all routes (endpoint doesn't exist yet)

- [ ] **Step 3: Implement the endpoint**

In `packages/server/src/api/library.js`, add after the existing `router.get('/library', ...)` handler (around line 501). Read the file first to find the exact insertion point.

```javascript
// Canonical album detail endpoint — single source of truth for album data.
// Accepts album PK, rgid, or mbid. Returns album metadata + tracks with file status.
router.get('/album/:id', (req, res) => {
  try {
    const resolved = db.getAlbumByAnyId(req.params.id);
    if (!resolved) return res.status(404).json({ error: 'not_found' });

    const albumData = db.getAlbumWithTracks(resolved.id);
    if (!albumData) return res.status(404).json({ error: 'not_found' });

    // Build canonical response shape
    const tracks = (albumData.tracks || []).map(t => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      trackNumber: t.trackNumber,
      discNumber: t.discNumber || 1,
      duration: t.duration,
      mbid: t.mbid || null,
      file: t.filepath ? {
        format: t.format,
        bitrate: t.bitrate || null,
        fileSize: t.fileSize || null,
        filepath: t.filepath,
      } : null,
    }));

    res.json({
      id: albumData.id,
      artist: albumData.album_artist,
      album: albumData.title,
      year: albumData.year || null,
      rgid: albumData.rgid || null,
      mbid: albumData.mbid || null,
      coverArt: albumData.cover_art_url || (albumData.rgid ? `/api/cover/rg/${albumData.rgid}` : null),
      trackCount: tracks.length,
      duration: tracks.reduce((s, t) => s + (t.duration || 0), 0),
      inLibrary: tracks.some(t => t.file !== null),
      compilation: !!albumData.compilation,
      tracks,
    });
  } catch (err) {
    console.error('[album] Error fetching album:', err.message);
    res.status(500).json({ error: 'internal' });
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && npx jest __tests__/api/album-detail.test.js --no-cache`
Expected: PASS (3 tests)

NOTE: The mock may need adjustment depending on what `getAlbumWithTracks` actually returns (the `_groupAlbumRows` function transforms the JOIN rows). Read the actual return shape and adjust the mock accordingly.

- [ ] **Step 5: Run full suite**

Run: `cd packages/server && npx jest --no-cache 2>&1 | tail -5`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/api/library.js packages/server/__tests__/api/album-detail.test.js
git commit -m "feat: add GET /api/album/:id canonical endpoint

Single source of truth for album data. Resolves by PK, rgid, or mbid.
Returns album metadata + tracks with file status inline."
```

---

### Task 3: Add `getAlbum(id)` to api-client.js

**Files:**
- Modify: `packages/shared/src/api-client.js`

**Context:** The shared API client needs a function to call the new endpoint. Follow the existing pattern of the `get()` helper.

- [ ] **Step 1: Add the function**

In `packages/shared/src/api-client.js`, after the existing `getLibrary` function (~line 158), add:

```javascript
export function getAlbum(id) {
  return get(`/api/album/${enc(id)}`);
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/shared/src/api-client.js
git commit -m "feat: add getAlbum(id) to api-client for canonical album fetch"
```

---

### Task 4: Migrate `openAlbumFromLibrary` to use canonical endpoint

**Files:**
- Modify: `packages/client/src/App.jsx:628-641`

**Context:** Currently `openAlbumFromLibrary` receives 6 arguments and builds an ad-hoc object. Change it to accept an `albumId` and fetch from the canonical endpoint. The library album objects already have `albumId` (from `useLibrary` → `libraryAlbums`, line 82).

- [ ] **Step 1: Read App.jsx to understand all callers of openAlbumFromLibrary**

Search for `openAlbumFromLibrary(` in App.jsx to find all call sites. Each one passes `(artist, albumName, tracks, coverArt, mbid, rgid)`. These callers need to change to pass `albumId` instead.

- [ ] **Step 2: Rewrite openAlbumFromLibrary**

Replace lines 628-641:

```javascript
// BEFORE:
function openAlbumFromLibrary(artist, albumName, tracks, coverArt, mbid, rgid) {
  try { telemetry.emit('nav_album', { source: 'library', artist, album: albumName }); } catch {}
  loadLibrary();
  const pl = tracks.map(t => ({ ...t, path: buildTrackPath(t.id), coverArt }));
  const year = tracks.find(t => t.year)?.year
    || recentlyPlayed.find(r => r.artist === artist && r.album === albumName)?.year
    || '';
  setSelectedAlbum({ artist, album: albumName, year, tracks: pl, coverArt, mbid, rgid, sources: [], fromSearch: false });
  prevViewRef.current = view;
  setView('album');
}
```

With:

```javascript
// AFTER: Fetch from canonical endpoint
async function openAlbumFromLibrary(albumId, fallback) {
  try { telemetry.emit('nav_album', { source: 'library', albumId }); } catch {}
  prevViewRef.current = view;
  setView('album');

  try {
    const album = await api.getAlbum(albumId);
    const tracks = (album.tracks || []).map(t => ({
      ...t,
      id: t.id,
      path: buildTrackPath(t.id),
      coverArt: album.coverArt,
      format: t.file?.format,
      filepath: t.file?.filepath,
      fileSize: t.file?.fileSize,
    }));
    setSelectedAlbum({
      artist: album.artist,
      album: album.album,
      year: album.year || '',
      tracks,
      coverArt: album.coverArt,
      mbid: album.mbid,
      rgid: album.rgid,
      sources: [],
      fromSearch: false,
      inLibrary: album.inLibrary,
    });
    loadLibrary();
  } catch (err) {
    // Fallback to old behavior if endpoint fails (e.g. album not in new schema)
    if (fallback) {
      const { artist, albumName, tracks, coverArt, mbid, rgid } = fallback;
      const pl = tracks.map(t => ({ ...t, path: buildTrackPath(t.id), coverArt }));
      const year = tracks.find(t => t.year)?.year || '';
      setSelectedAlbum({ artist, album: albumName, year, tracks: pl, coverArt, mbid, rgid, sources: [], fromSearch: false });
    }
    console.warn('[openAlbumFromLibrary] Canonical fetch failed, using fallback:', err.message);
  }
}
```

- [ ] **Step 3: Update all callers**

Find every place that calls `openAlbumFromLibrary(artist, album, tracks, coverArt, mbid, rgid)` and change to `openAlbumFromLibrary(albumId, { artist, albumName, tracks, coverArt, mbid, rgid })`.

The library album objects already have `albumId`. Callers in the sidebar and library grid should pass `album.albumId` as the first argument and the old args as fallback.

- [ ] **Step 4: Verify manually**

1. Click an album from the library sidebar — should show correct data with year, duration, coverArt
2. Compare with clicking the same album from search results — should show same data
3. Check browser Network tab — should see `GET /api/album/{id}` call

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/App.jsx
git commit -m "feat: openAlbumFromLibrary fetches from canonical endpoint

Library albums now fetch from GET /api/album/:id instead of
constructing ad-hoc objects. Includes fallback to old behavior
if the canonical endpoint fails."
```

---

### Task 5: Fix edition picker visibility

**Files:**
- Modify: `packages/client/src/components/AlbumView.jsx:352`

**Context:** The edition picker is guarded by `mbEditions?.length > 1 && (fromSearch || selectedAlbum.mbid || rgid)`. The `fromSearch`/`mbid`/`rgid` check is too restrictive — library albums opened from the sidebar don't have `fromSearch` set. Since `mbEditions` is only populated when MB data loads (which requires rgid), the guard is redundant.

- [ ] **Step 1: Read AlbumView.jsx line 352 to confirm current condition**

- [ ] **Step 2: Simplify the condition**

Change line 352 from:
```javascript
{mbEditions?.length > 1 && (fromSearch || selectedAlbum.mbid || rgid) && (() => {
```
to:
```javascript
{mbEditions?.length > 1 && (() => {
```

- [ ] **Step 3: Verify manually**

1. Open an album from the library sidebar — edition picker should now be visible (if MB data has multiple editions)
2. Open same album from search results — edition picker also visible
3. Open from recently played — edition picker also visible
4. Switch editions — tracklist updates correctly

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/components/AlbumView.jsx
git commit -m "fix: show edition picker from all entry points

Simplified condition to mbEditions?.length > 1 — the guard was
preventing the picker from showing when albums were opened from
library or recently played (where fromSearch is false)."
```
