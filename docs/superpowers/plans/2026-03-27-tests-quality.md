# Tests & Code Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve test infrastructure and address 12 code quality findings.

**Architecture:** Create shared test utilities, extract constants, remove dead code and unused dependencies.

**Tech Stack:** Jest, React, Node.js, npm

---

## File Map

| Task | Create | Modify | Test |
|------|--------|--------|------|
| 1 (T1) | `packages/server/__tests__/helpers/mock-db.js` | `packages/server/__tests__/api/cast.test.js`, `packages/server/__tests__/api/library.test.js` | `npx jest --no-cache` |
| 2 (T2) | — | `packages/server/__tests__/api/cast.test.js` | `npx jest __tests__/api/cast.test.js` |
| 3 (T3) | — | `packages/server/__tests__/api/library.test.js` | `npx jest __tests__/api/library.test.js` |
| 4 (T4) | `packages/server/__tests__/perf/health-benchmark.test.js` | — | `npx jest __tests__/perf/health-benchmark.test.js` |
| 5 (T5) | `packages/client/__tests__/a11y.test.jsx` | — | `npm run test -w @not-ify/client` |
| 6 (Q1) | `packages/server/src/utils/api-error.js` | `packages/server/src/api/youtube.js`, `packages/server/src/api/import.js` | `npx jest --no-cache` |
| 7 (Q2) | — | `packages/server/src/api/import.js` | `npx jest __tests__/api/lastfm-import.test.js` |
| 8 (Q3) | — | `packages/server/src/api/youtube.js` | `npx jest __tests__/api/youtube.test.js` |
| 9 (Q4) | — | `packages/client/src/components/AlbumView.jsx` | Visual inspection |
| 10 (Q5) | — | `packages/client/src/hooks/useDownload.js` | Manual verification |
| 11 (Q6) | — | `packages/client/src/hooks/useDownload.js` | Manual verification |
| 12 (Q7) | — | `packages/server/package.json` | `npm ls node-ssdp upnp-client-ts` |

---

### Task 1: Create shared mock factory for DB (T1)

**Files:**
- Create: `packages/server/__tests__/helpers/mock-db.js`
- Modify: `packages/server/__tests__/api/cast.test.js` (lines 12-43)
- Modify: `packages/server/__tests__/api/library.test.js` (lines 46-86)

**Context:** Every API test file has 15-30 lines of identical `jest.mock('../../src/services/db', ...)` boilerplate. The mock object in `cast.test.js` (lines 12-43) and `library.test.js` (lines 46-86) are nearly identical. A shared factory reduces duplication and makes it easier to add new DB methods without updating 10+ files.

- [ ] **Step 1: Create the shared mock factory**

```javascript
// packages/server/__tests__/helpers/mock-db.js
'use strict';

/**
 * Shared DB mock factory.
 * Usage in test files:
 *   const { createMockDb } = require('../helpers/mock-db');
 *   jest.mock('../../src/services/db', () => createMockDb());
 *
 * For per-test overrides:
 *   const mockDb = createMockDb();
 *   mockDb.isValidUser.mockReturnValue(false);
 *   jest.mock('../../src/services/db', () => mockDb);
 */
function createMockDb() {
  return {
    getDb: jest.fn(),
    isValidUser: jest.fn().mockReturnValue(true),
    isSetupComplete: jest.fn().mockReturnValue(true),
    getDefaultUserId: jest.fn().mockReturnValue('default'),
    getUsers: jest.fn().mockReturnValue([]),
    getRecentlyPlayed: jest.fn().mockReturnValue([]),
    addRecentlyPlayed: jest.fn().mockReturnValue([]),
    bulkSetRecentlyPlayed: jest.fn().mockReturnValue([]),
    getLastfmConfig: jest.fn().mockReturnValue({}),
    saveLastfmConfig: jest.fn(),
    clearLastfmConfig: jest.fn(),
    getScrobbleQueue: jest.fn().mockReturnValue([]),
    addToScrobbleQueue: jest.fn(),
    removeFromScrobbleQueue: jest.fn(),
    getAllUsersWithScrobbleQueue: jest.fn().mockReturnValue([]),
    getGlobalSetting: jest.fn(),
    setGlobalSetting: jest.fn(),
    getUserSetting: jest.fn(),
    setUserSetting: jest.fn(),
    getAllUserSettings: jest.fn().mockReturnValue({}),
    getSearchHistory: jest.fn().mockReturnValue([]),
    addSearchHistory: jest.fn(),
    removeSearchHistory: jest.fn(),
    clearSearchHistory: jest.fn(),
    getFavorites: jest.fn().mockReturnValue([]),
    addFavorite: jest.fn(),
    removeFavorite: jest.fn(),
    isFavorite: jest.fn().mockReturnValue(false),
    getUserSession: jest.fn().mockReturnValue({ queue: [], state: {} }),
    saveUserSession: jest.fn(),
  };
}

module.exports = { createMockDb };
```

- [ ] **Step 2: Migrate cast.test.js to use the factory**

In `packages/server/__tests__/api/cast.test.js`, replace lines 12-43:

```javascript
jest.mock('../../src/services/db', () => ({
  getDb: jest.fn(),
  isValidUser: jest.fn().mockReturnValue(true),
  isSetupComplete: jest.fn().mockReturnValue(true),
  getDefaultUserId: jest.fn().mockReturnValue('default'),
  getUsers: jest.fn().mockReturnValue([]),
  getRecentlyPlayed: jest.fn().mockReturnValue([]),
  addRecentlyPlayed: jest.fn().mockReturnValue([]),
  bulkSetRecentlyPlayed: jest.fn().mockReturnValue([]),
  getLastfmConfig: jest.fn().mockReturnValue({}),
  saveLastfmConfig: jest.fn(),
  clearLastfmConfig: jest.fn(),
  getScrobbleQueue: jest.fn().mockReturnValue([]),
  addToScrobbleQueue: jest.fn(),
  removeFromScrobbleQueue: jest.fn(),
  getAllUsersWithScrobbleQueue: jest.fn().mockReturnValue([]),
  getGlobalSetting: jest.fn(),
  setGlobalSetting: jest.fn(),
  getUserSetting: jest.fn(),
  setUserSetting: jest.fn(),
  getAllUserSettings: jest.fn().mockReturnValue({}),
  getSearchHistory: jest.fn().mockReturnValue([]),
  addSearchHistory: jest.fn(),
  removeSearchHistory: jest.fn(),
  clearSearchHistory: jest.fn(),
  getFavorites: jest.fn().mockReturnValue([]),
  addFavorite: jest.fn(),
  removeFavorite: jest.fn(),
  isFavorite: jest.fn().mockReturnValue(false),
  getUserSession: jest.fn().mockReturnValue({ queue: [], state: {} }),
  saveUserSession: jest.fn(),
}));
```

with:

```javascript
const { createMockDb } = require('../helpers/mock-db');
jest.mock('../../src/services/db', () => createMockDb());
```

- [ ] **Step 3: Migrate library.test.js to use the factory**

In `packages/server/__tests__/api/library.test.js`, replace the `jest.mock('../../src/services/db', ...)` block (lines 46-86) with:

```javascript
const { createMockDb } = require('../helpers/mock-db');
const mockTracks = new Map();
jest.mock('../../src/services/db', () => ({
  ...createMockDb(),
  // Track CRUD for stable track IDs
  upsertTrack: jest.fn(({ id, filepath, ...rest }) => { mockTracks.set(id, { id, filepath, ...rest }); }),
  getTrackById: jest.fn((id) => mockTracks.get(id) || null),
  getAllTracks: jest.fn(() => [...mockTracks.values()]),
  getTracksByAlbum: jest.fn(() => []),
  removeTrackByFilepath: jest.fn((fp) => { for (const [k, v] of mockTracks) { if (v.filepath === fp) mockTracks.delete(k); } }),
  removeTrackById: jest.fn((id) => { mockTracks.delete(id); }),
  syncAlbumTracks: jest.fn(),
  pruneDeletedTracks: jest.fn(),
}));
```

Note: `library.test.js` extends the base mock with track CRUD methods, so it uses spread + overrides.

- [ ] **Step 4: Run all tests to verify no regressions**

Run: `cd packages/server && npx jest --no-cache`
Expected: All tests pass with same results as before

- [ ] **Step 5: Commit**

```bash
git add packages/server/__tests__/helpers/mock-db.js packages/server/__tests__/api/cast.test.js packages/server/__tests__/api/library.test.js
git commit -m "test: create shared DB mock factory to reduce boilerplate (T1)"
```

---

### Task 2: Replace private IP in cast.test.js (T2)

**Files:**
- Modify: `packages/server/__tests__/api/cast.test.js:76`

**Context:** The test uses `192.168.1.50` as a device IP, which is a real private network address. RFC 5737 reserves `192.0.2.0/24`, `198.51.100.0/24`, and `203.0.113.0/24` for documentation. For test fixtures, `10.0.0.x` (RFC 1918 Class A) is also conventional and clearly non-routable.

- [ ] **Step 1: Replace the private IP**

In `packages/server/__tests__/api/cast.test.js` line 76, change:

```javascript
const DEVICE = { usn: 'uuid:test-device', friendlyName: 'Test Speaker', ip: '192.168.1.50', location: 'http://192.168.1.50:1400/desc', lastSeen: Date.now() };
```

to:

```javascript
const DEVICE = { usn: 'uuid:test-device', friendlyName: 'Test Speaker', ip: '198.51.100.1', location: 'http://198.51.100.1:1400/desc', lastSeen: Date.now() };
```

Using `198.51.100.1` (TEST-NET-2, RFC 5737) which is explicitly reserved for documentation and testing.

- [ ] **Step 2: Run cast tests to verify**

Run: `cd packages/server && npx jest __tests__/api/cast.test.js --no-cache`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/server/__tests__/api/cast.test.js
git commit -m "test: use RFC 5737 TEST-NET IP in cast test fixture (T2)"
```

---

### Task 3: Add failure test cases for DB mocks (T3)

**Files:**
- Modify: `packages/server/__tests__/api/library.test.js`

**Context:** All DB mocks return success values. There are no tests for invalid user IDs, missing tracks, or DB errors. Add test cases that exercise error paths.

- [ ] **Step 1: Write failing test for invalid user**

Add to the end of `packages/server/__tests__/api/library.test.js`:

```javascript
// ── Error path tests ────────────────────────────────────────────────────────

describe('Error paths', () => {
  test('GET /api/library returns 403 for invalid user', async () => {
    const db = require('../../src/services/db');
    db.isValidUser.mockReturnValueOnce(false);
    const res = await request(app).get('/api/library');
    expect(res.status).toBe(403);
  });

  test('GET /api/stream/:id returns 404 for missing track', async () => {
    const res = await request(app).get('/api/stream/nonexistent-track-id?sig=testhash&exp=9999999999');
    expect(res.status).toBe(404);
  });

  test('DELETE /api/library/track/:id returns 404 for missing track', async () => {
    const db = require('../../src/services/db');
    db.getTrackById.mockReturnValueOnce(null);
    const res = await request(app).delete('/api/library/track/nonexistent');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify new tests pass**

Run: `cd packages/server && npx jest __tests__/api/library.test.js --no-cache`
Expected: PASS — these error paths should already be handled by the API; we are verifying they work.

If any test fails, that reveals a missing error handler in the API code — fix the handler (adding `if (!user) return res.status(403).json(...)` etc.) before re-running.

- [ ] **Step 3: Commit**

```bash
git add packages/server/__tests__/api/library.test.js
git commit -m "test: add error path test cases for library API (T3)"
```

---

### Task 4: Add basic performance benchmark test (T4)

**Files:**
- Create: `packages/server/__tests__/perf/health-benchmark.test.js`

**Context:** No performance tests exist. A basic benchmark verifying the health endpoint responds under a latency threshold catches performance regressions early.

- [ ] **Step 1: Create the benchmark test**

```javascript
// packages/server/__tests__/perf/health-benchmark.test.js
'use strict';

// Reuse the standard mock setup — this test focuses on response latency, not DB behavior
const { createMockDb } = require('../helpers/mock-db');
jest.mock('../../src/services/db', () => createMockDb());
jest.mock('../../src/services/search', () => ({ searchMusic: jest.fn().mockResolvedValue([]) }));
jest.mock('../../src/services/musicbrainz', () => ({
  searchReleases: jest.fn().mockResolvedValue([]),
  searchArtists: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../src/services/youtube', () => ({
  search: jest.fn().mockResolvedValue([]),
  getStreamUrl: jest.fn().mockResolvedValue('http://example.com/stream'),
}));
jest.mock('../../src/services/llm', () => ({ checkHealth: jest.fn().mockResolvedValue(false) }));
jest.mock('../../src/services/lastfm', () => ({}));
jest.mock('../../src/services/realdebrid', () => ({}));
jest.mock('../../src/services/migrate', () => ({ migrate: jest.fn() }));
jest.mock('../../src/services/job-queue', () => ({
  enqueue: jest.fn(), dequeue: jest.fn(), complete: jest.fn(), fail: jest.fn(),
  skip: jest.fn(), getByType: jest.fn().mockReturnValue([]),
  getByStatus: jest.fn().mockReturnValue([]),
  getAll: jest.fn().mockReturnValue([]), getStats: jest.fn().mockReturnValue({}),
}));

const request = require('supertest');
const app = require('../../src/index');

describe('Health endpoint performance', () => {
  test('responds under 100ms for 50 sequential requests', async () => {
    const iterations = 50;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
    }

    const elapsed = performance.now() - start;
    const avgMs = elapsed / iterations;

    console.log(`Health endpoint: ${iterations} requests in ${elapsed.toFixed(0)}ms (avg ${avgMs.toFixed(1)}ms)`);
    expect(avgMs).toBeLessThan(100);
  });
});
```

- [ ] **Step 2: Create the perf directory and run the test**

Run: `mkdir -p packages/server/__tests__/perf && cd packages/server && npx jest __tests__/perf/health-benchmark.test.js --no-cache`
Expected: PASS with avg latency well under 100ms

- [ ] **Step 3: Commit**

```bash
git add packages/server/__tests__/perf/health-benchmark.test.js
git commit -m "test: add basic health endpoint performance benchmark (T4)"
```

---

### Task 5: Add basic accessibility test (T5)

**Files:**
- Create: `packages/client/__tests__/a11y.test.jsx`

**Context:** No accessibility tests exist. A basic test using `jest-axe` can catch missing alt text, missing labels, and ARIA violations. This requires adding `jest-axe` as a dev dependency.

- [ ] **Step 1: Install jest-axe**

Run: `cd packages/client && npm install --save-dev jest-axe`

- [ ] **Step 2: Create basic a11y test**

```jsx
// packages/client/__tests__/a11y.test.jsx
import React from 'react';
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

// Test a minimal HTML structure that represents the app shell
// Full component a11y tests would require mocking the entire app context
describe('Accessibility basics', () => {
  test('app shell has no a11y violations', async () => {
    const { container } = render(
      <main role="main" aria-label="Not-ify music player">
        <nav aria-label="Main navigation">
          <button aria-label="Search">Search</button>
          <button aria-label="Library">Library</button>
          <button aria-label="Settings">Settings</button>
        </nav>
        <section aria-label="Content area">
          <h1>Library</h1>
        </section>
      </main>
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  test('buttons without text need aria-label', async () => {
    const { container } = render(
      <div>
        <button aria-label="Play">
          <span className="icon" />
        </button>
      </div>
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
```

- [ ] **Step 3: Run the test**

Run: `cd packages/client && npm test -- --testPathPattern=a11y`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/client/__tests__/a11y.test.jsx packages/client/package.json packages/client/package-lock.json
git commit -m "test: add basic accessibility tests with jest-axe (T5)"
```

---

### Task 6: Create standardized API error helper (Q1)

**Files:**
- Create: `packages/server/src/utils/api-error.js`
- Modify: `packages/server/src/api/youtube.js` (example migration)
- Modify: `packages/server/src/api/import.js` (example migration)

**Context:** Error responses across the API are inconsistent. Some use `{ error: 'message' }`, others use `{ error: { message, code } }`, and some use `{ status: 'error', error: 'message' }`. A shared helper standardizes the format.

- [ ] **Step 1: Create the error helper**

```javascript
// packages/server/src/utils/api-error.js
'use strict';

/**
 * Standardized API error response.
 * Always returns: { error: string, code?: string }
 *
 * Usage:
 *   const { apiError } = require('../utils/api-error');
 *   return apiError(res, 400, 'Missing required field', 'MISSING_FIELD');
 *   return apiError(res, 500, err.message);
 */
function apiError(res, status, message, code) {
  const body = { error: message };
  if (code) body.code = code;
  return res.status(status).json(body);
}

/**
 * Wraps an async route handler to catch unhandled rejections.
 * Usage:
 *   router.get('/path', asyncHandler(async (req, res) => { ... }));
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { apiError, asyncHandler };
```

- [ ] **Step 2: Write test for the helper**

```javascript
// packages/server/__tests__/unit/api-error.test.js
'use strict';

const { apiError, asyncHandler } = require('../../src/utils/api-error');

describe('apiError', () => {
  test('sends status and error message', () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    apiError(res, 400, 'Bad input');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Bad input' });
  });

  test('includes error code when provided', () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    apiError(res, 404, 'Not found', 'NOT_FOUND');
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found', code: 'NOT_FOUND' });
  });
});

describe('asyncHandler', () => {
  test('calls next on rejected promise', async () => {
    const error = new Error('boom');
    const handler = asyncHandler(async () => { throw error; });
    const next = jest.fn();
    await handler({}, {}, next);
    expect(next).toHaveBeenCalledWith(error);
  });
});
```

- [ ] **Step 3: Run test**

Run: `cd packages/server && npx jest __tests__/unit/api-error.test.js --no-cache`
Expected: PASS

- [ ] **Step 4: Migrate one example in youtube.js**

In `packages/server/src/api/youtube.js`, add at the top (after the other requires, around line 11):

```javascript
const { apiError } = require('../utils/api-error');
```

Then replace line 35:

```javascript
  if (!q) return res.status(400).json({ error: 'Missing q parameter' });
```

with:

```javascript
  if (!q) return apiError(res, 400, 'Missing q parameter', 'MISSING_PARAM');
```

- [ ] **Step 5: Run youtube tests to verify no regression**

Run: `cd packages/server && npx jest __tests__/api/youtube.test.js --no-cache`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/utils/api-error.js packages/server/__tests__/unit/api-error.test.js packages/server/src/api/youtube.js
git commit -m "refactor: create standardized API error helper (Q1)"
```

---

### Task 7: Extract magic numbers in import.js (Q2)

**Files:**
- Modify: `packages/server/src/api/import.js`

**Context:** `import.js` has several magic numbers: `30000` (ms played threshold, line 43), `1500` (rate limit delay, line 208), `30000` (AbortSignal timeout, lines 131, 186), `1000` (MB rate limit, line 386), `60` (default days, line 227). Extract these to named constants for readability.

- [ ] **Step 1: Add constants block at the top of import.js**

After line 7 (`const router = express.Router();`), add:

```javascript
// ─── Constants ─────────────────────────────────────────────────────────────

const MIN_PLAY_MS = 30_000;                // Minimum ms_played to count (skip < 30s plays)
const SEARCH_TIMEOUT_MS = 30_000;           // Timeout for internal search API calls
const BATCH_SEARCH_DELAY_MS = 1_500;        // Rate limit between batch search API calls
const MB_LOOKUP_DELAY_MS = 1_000;           // Rate limit between MusicBrainz lookups
const DEFAULT_IMPORT_DAYS = 60;             // Default lookback window for last.fm import
const STALE_SYNC_THRESHOLD_MS = 6 * 60 * 60 * 1000;  // 6 hours — trigger delta sync if older
```

- [ ] **Step 2: Replace magic numbers with constants**

Line 43: change `if (ms < 30000) continue;` to `if (ms < MIN_PLAY_MS) continue;`

Line 131: change `signal: AbortSignal.timeout(30000),` to `signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),`

Line 186: change `signal: AbortSignal.timeout(30000),` to `signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),`

Line 208: change `if (searched < toSearch.length) await new Promise(r => setTimeout(r, 1500));` to `if (searched < toSearch.length) await new Promise(r => setTimeout(r, BATCH_SEARCH_DELAY_MS));`

Line 227: change `const { days = 60 } = req.body;` to `const { days = DEFAULT_IMPORT_DAYS } = req.body;`

Line 239: change `const STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000;` to use the module-level constant. Remove the local `STALE_THRESHOLD_MS` declaration and change line 241 to use `STALE_SYNC_THRESHOLD_MS`:
```javascript
  const isSyncStale = (Date.now() - lastSyncedAt * 1000) > STALE_SYNC_THRESHOLD_MS;
```

Line 386: change `await new Promise(r => setTimeout(r, 1000));` to `await new Promise(r => setTimeout(r, MB_LOOKUP_DELAY_MS));`

- [ ] **Step 3: Run import tests to verify**

Run: `cd packages/server && npx jest __tests__/api/lastfm-import.test.js --no-cache`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/api/import.js
git commit -m "refactor: extract magic numbers to named constants in import.js (Q2)"
```

---

### Task 8: Remove dead code MUSIC_DIR = null (Q3)

**Files:**
- Modify: `packages/server/src/api/youtube.js:22`

**Context:** Line 22 declares `const MUSIC_DIR = null;` with a comment "DEPRECATED — use getMusicDir() instead". This variable is never used — `getMusicDir()` is called directly everywhere. The dead declaration is confusing.

- [ ] **Step 1: Verify MUSIC_DIR is not referenced anywhere in youtube.js**

Search for `MUSIC_DIR` usage in the file (excluding the declaration and the `getMusicDir` function). If it is used, update those references to `getMusicDir()` first.

Run: `grep -n 'MUSIC_DIR' packages/server/src/api/youtube.js`

Expected: Only line 17 (inside getMusicDir) and line 22 (the dead declaration).

- [ ] **Step 2: Remove the dead line**

In `packages/server/src/api/youtube.js`, delete line 22:

```javascript
const MUSIC_DIR = null; // DEPRECATED — use getMusicDir() instead
```

- [ ] **Step 3: Run youtube tests to verify**

Run: `cd packages/server && npx jest __tests__/api/youtube.test.js --no-cache`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/api/youtube.js
git commit -m "cleanup: remove dead MUSIC_DIR = null declaration (Q3)"
```

---

### Task 9: Document AlbumView prop count as tech debt (Q4)

**Files:**
- Modify: `packages/client/src/components/AlbumView.jsx`

**Context:** AlbumView accepts 40+ props (lines 11-48). This is a code smell but refactoring it requires breaking the component into sub-components with a context provider — that is v2 scope. Document it as known tech debt.

- [ ] **Step 1: Add a JSDoc comment documenting the tech debt**

In `packages/client/src/components/AlbumView.jsx`, before line 11 (`export function AlbumView({`), add:

```javascript
/**
 * AlbumView — renders the album detail page with tracks, controls, and metadata.
 *
 * TECH DEBT: This component accepts 40+ props because it was grown incrementally
 * as features were added. v2 refactor plan: extract sub-components (TrackList,
 * AlbumHeader, AlbumActions) and use a context provider for shared state.
 * See: docs/superpowers/plans/ for the v2 architecture plan.
 */
```

- [ ] **Step 2: Commit**

```bash
git add packages/client/src/components/AlbumView.jsx
git commit -m "docs: document AlbumView 40+ props as known tech debt for v2 (Q4)"
```

---

### Task 10: Add shared error handling to useDownload hook (Q5)

**Files:**
- Modify: `packages/client/src/hooks/useDownload.js`

**Context:** The `useDownload` hook has multiple `catch` blocks that silently swallow errors (lines 212, 262, 347). Some of these should at least log the error for debugging. Add consistent error handling.

- [ ] **Step 1: Add a logging helper at the top of the hook**

In `packages/client/src/hooks/useDownload.js`, after line 4 (before `export function useDownload`), add:

```javascript
function logError(context, err) {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[useDownload] ${context}:`, err?.message || err);
  }
}
```

- [ ] **Step 2: Replace silent catch blocks**

Line 212: change `} catch { clearInterval(pollId); }` to:
```javascript
} catch (err) { logError('YT poll', err); clearInterval(pollId); }
```

Find the bgPoll catch block (around line 275-276 area) and update similarly if it has a silent catch.

Find the jobQueuePoll catch block (around line 347-350 area) and update similarly.

- [ ] **Step 3: Verify manually**

1. Open browser devtools console
2. Trigger a download
3. Verify no new errors appear (in dev mode, the `console.warn` messages should only appear on actual failures)

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/hooks/useDownload.js
git commit -m "fix: add error logging to silent catch blocks in useDownload (Q5)"
```

---

### Task 11: Extract magic polling intervals in useDownload (Q6)

**Files:**
- Modify: `packages/client/src/hooks/useDownload.js`

**Context:** The hook uses magic numbers for polling intervals: `2000` (YT poll, line 213), `3000` (bg poll, lines 262, 276, 350), `4000` (job queue clear delay, line 347). Extract to named constants.

- [ ] **Step 1: Add constants at the top of the file**

In `packages/client/src/hooks/useDownload.js`, after line 3 (`import { buildTrackPath } from '../utils';`), add:

```javascript
const YT_POLL_INTERVAL_MS = 2000;       // Poll YT download progress every 2s
const BG_POLL_INTERVAL_MS = 3000;       // Poll background downloads every 3s
const JOB_QUEUE_POLL_MS = 3000;         // Poll job queue stats every 3s
const DL_COMPLETE_CLEAR_MS = 2000;      // Clear download status 2s after completion
const BG_COMPLETE_CLEAR_MS = 3000;      // Clear bg download status 3s after completion
const JOB_COMPLETE_CLEAR_MS = 4000;     // Clear job queue stats 4s after completion
```

- [ ] **Step 2: Replace magic numbers with constants**

Line 193 (`setInterval(async () => {`, the interval argument at line 213): change `}, 2000);` to `}, YT_POLL_INTERVAL_MS);`

Line 210 (`setTimeout(() => { setDownloading(null);`): change `}, 2000);` to `}, DL_COMPLETE_CLEAR_MS);`

Line 226 (`bgPollRef.current = setInterval(async () => {`, at line 276): change `}, 3000);` to `}, BG_POLL_INTERVAL_MS);`

Line 262 (`setTimeout(() => setBgDownloadStatus(null),`): change `3000);` to `BG_COMPLETE_CLEAR_MS);`

Line 331 (`jobQueuePollRef.current = setInterval(async () => {`, at line 350): change `}, 3000);` to `}, JOB_QUEUE_POLL_MS);`

Line 347 (`setTimeout(() => setJobQueueStats(null),`): change `4000);` to `JOB_COMPLETE_CLEAR_MS);`

- [ ] **Step 3: Verify manually**

1. Trigger a download and verify polling still works correctly
2. Verify status clears after the expected delay

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/hooks/useDownload.js
git commit -m "refactor: extract magic polling intervals to named constants (Q6)"
```

---

### Task 12: Remove unused dependencies node-ssdp and upnp-client-ts (Q7)

**Files:**
- Modify: `packages/server/package.json`

**Context:** `node-ssdp` (line 19) and `upnp-client-ts` (line 24) are listed as production dependencies but are NOT imported anywhere in `packages/server/src/`. The DLNA service (`packages/server/src/services/dlna.js`) uses raw `dgram` and `http` modules instead. These packages are only referenced in test mocks (`cast.test.js`, `dlna.test.js`) — where they are mocked and never actually loaded.

- [ ] **Step 1: Verify no production code imports these packages**

Run: `grep -r "require.*node-ssdp\|require.*upnp-client-ts\|from.*node-ssdp\|from.*upnp-client-ts" packages/server/src/`
Expected: No matches

Run: `grep -r "require.*node-ssdp\|require.*upnp-client-ts" packages/server/__tests__/`
Expected: Only mock declarations (jest.mock lines), not actual imports

- [ ] **Step 2: Remove the unused dependencies**

Run: `cd packages/server && npm uninstall node-ssdp upnp-client-ts`

This will:
- Remove them from `packages/server/package.json` dependencies
- Update `package-lock.json`

- [ ] **Step 3: Update test mocks to not reference the packages**

The test mocks in `cast.test.js` and `dlna.test.js` mock these modules to prevent import errors. Since the production code never imports them, these mocks are unnecessary. However, if removing the mocks causes test failures (because the app transitively loads them), keep the mocks.

Run: `cd packages/server && npx jest --no-cache`

If tests pass: remove the unnecessary mock declarations from `cast.test.js` (lines 4-11) and `dlna.test.js` (lines 3-14).

If tests fail with MODULE_NOT_FOUND for node-ssdp/upnp-client-ts: there is a hidden dependency. In that case, revert the uninstall and add a comment explaining why they are needed.

- [ ] **Step 4: Run full test suite to verify**

Run: `cd packages/server && npx jest --no-cache`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/server/package.json package-lock.json
# Also add test files if mocks were removed:
# git add packages/server/__tests__/api/cast.test.js packages/server/__tests__/unit/dlna.test.js
git commit -m "cleanup: remove unused node-ssdp and upnp-client-ts dependencies (Q7)"
```
