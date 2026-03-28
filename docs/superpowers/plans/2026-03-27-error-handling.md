# Error Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add proper error handling across 8 locations identified in the code review. Replace silent catches with logged catches, add an Error Boundary to the React app, and add specific error type checks.

**Architecture:** Add Error Boundary to React app, replace silent catches with logged catches, add specific error type checks.

**Tech Stack:** React, Node.js, Express, Jest

---

## File Map

| Task | Create | Modify | Test |
|------|--------|--------|------|
| 1 (E1) | `packages/client/src/components/ErrorBoundary.jsx` | `packages/client/src/App.jsx` | (manual verification — React error boundary) |
| 2 (E2) | — | `packages/server/src/api/setup.js` | `packages/server/__tests__/api/setup-library.test.js` |
| 3 (E3) | — | `packages/server/src/api/pipeline.js` | (manual verification — log output) |
| 4 (E4) | — | `packages/server/src/api/youtube.js` | `packages/server/__tests__/api/youtube-enoent.test.js` |
| 5 (E5) | — | `packages/server/src/api/search.js` | (manual verification — log output) |
| 6 (E6) | — | `packages/server/src/services/job-processor.js` | `packages/server/__tests__/services/job-processor-parse.test.js` |
| 7 (E7) | — | `packages/client/src/hooks/usePlayer.js` | (manual verification — console output) |
| 8 (E8) | — | `packages/client/src/hooks/useRecentlyPlayed.js` | (manual verification — UI indicator) |

---

### Task 1: Add Error Boundary to React app (E1)

**Files:**
- Create: `packages/client/src/components/ErrorBoundary.jsx`
- Modify: `packages/client/src/App.jsx:1151-1158`

**Context:** There is no Error Boundary in the React app. A single component crash (e.g. in AlbumView, SearchView, PlayerBar) takes down the entire app with a white screen. An Error Boundary around `<MainApp>` will catch render errors and show a recovery UI.

- [ ] **Step 1: Create ErrorBoundary component**

```jsx
// packages/client/src/components/ErrorBoundary.jsx
import React from 'react';
import { COLORS } from '../constants';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught render error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh',
          background: COLORS.bg, color: COLORS.text, fontFamily: 'Inter, system-ui, sans-serif',
          padding: '2rem', textAlign: 'center',
        }}>
          <h2 style={{ marginBottom: '1rem' }}>Something went wrong</h2>
          <p style={{ color: COLORS.textMuted, marginBottom: '1.5rem', maxWidth: '400px' }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '0.5rem 1.5rem', borderRadius: '6px', border: 'none',
              background: COLORS.accent, color: '#fff', cursor: 'pointer',
              fontSize: '0.95rem',
            }}
          >
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 2: Wrap MainApp in ErrorBoundary**

In `packages/client/src/App.jsx`, add import at the top (after the existing component imports, around line 20):
```javascript
import { ErrorBoundary } from './components/ErrorBoundary';
```

Then change lines 1151-1158 from:
```jsx
  return (
    <MainApp
      currentUser={currentUser}
      isAdmin={isAdmin}
      setIsAdmin={setIsAdmin}
      switchUser={switchUser}
    />
  );
```
to:
```jsx
  return (
    <ErrorBoundary>
      <MainApp
        currentUser={currentUser}
        isAdmin={isAdmin}
        setIsAdmin={setIsAdmin}
        switchUser={switchUser}
      />
    </ErrorBoundary>
  );
```

- [ ] **Step 3: Verify by manual testing**

1. Open the app normally — should render without issues
2. Temporarily add `throw new Error('test')` inside a component render to verify the boundary catches it and shows the recovery UI
3. Click "Reload App" — should recover

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/components/ErrorBoundary.jsx packages/client/src/App.jsx
git commit -m "feat: add React Error Boundary to prevent full-app crash (E1)"
```

---

### Task 2: Wrap execSync('df') in try-catch (E2)

**Files:**
- Modify: `packages/server/src/api/setup.js:81-95`
- Create: `packages/server/__tests__/api/setup-library.test.js`

**Context:** The `execSync('df')` call at line 87 is already inside a try-catch block (lines 81-95), which catches errors and sets `freeSpace = null`. The issue described in the code review is actually a false positive for the try-catch — the code already handles this. However, the catch block is bare (`catch {`) with no logging. If `df` fails for a reason other than "not available" (e.g. permission denied, corrupted filesystem), the error is silently swallowed. Fix: add a log message to the catch.

- [ ] **Step 1: Write test to verify freeSpace returns null on exec failure**

```javascript
// packages/server/__tests__/api/setup-library.test.js
'use strict';

jest.mock('../../src/services/db', () => ({
  getGlobalSetting: jest.fn().mockReturnValue('/app/music'),
  getUserCount: jest.fn().mockReturnValue(1),
  isSetupComplete: jest.fn().mockReturnValue(true),
}));

const request = require('supertest');
const express = require('express');
const fs = require('fs');

// Mock fs to simulate existing writable directory
jest.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => true });
jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

// Mock child_process to simulate df failure
jest.mock('child_process', () => ({
  execSync: jest.fn(() => { throw new Error('df: command not found'); }),
}));

const setupRouter = require('../../src/api/setup');

const app = express();
app.use('/api/setup', setupRouter);

test('GET /api/setup/library returns null freeSpace when df fails', async () => {
  const res = await request(app).get('/api/setup/library');
  expect(res.status).toBe(200);
  expect(res.body.freeSpace).toBeNull();
  expect(res.body.exists).toBe(true);
  expect(res.body.writable).toBe(true);
});
```

- [ ] **Step 2: Run test to verify baseline**

Run: `cd packages/server && npx jest __tests__/api/setup-library.test.js --no-cache`
Expected: PASS (the existing catch already handles this)

- [ ] **Step 3: Add logging to the catch block**

In `packages/server/src/api/setup.js` line 93, change:
```javascript
    } catch {
      freeSpace = null;
    }
```
to:
```javascript
    } catch (err) {
      console.warn(`[setup] Could not determine free space for ${musicDir}: ${err.message}`);
      freeSpace = null;
    }
```

- [ ] **Step 4: Run test to verify it still passes**

Run: `cd packages/server && npx jest __tests__/api/setup-library.test.js --no-cache`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/api/setup.js packages/server/__tests__/api/setup-library.test.js
git commit -m "fix: log warning when df fails in setup library check (E2)"
```

---

### Task 3: Replace empty .catch(() => {}) in pipeline.js (E3)

**Files:**
- Modify: `packages/server/src/api/pipeline.js:42, 83, 295-296, 434`

**Context:** There are several empty `.catch(() => {})` blocks in pipeline.js. While some are intentional fire-and-forget (e.g. deleting a torrent from RD on cancel), they should at minimum log at warn level so failures don't go unnoticed during debugging.

- [ ] **Step 1: Add logging to each empty catch**

In `packages/server/src/api/pipeline.js`:

**Line 42** — RD torrent delete on cancel:
```javascript
// Before:
    rd.deleteTorrent(activeDownload.torrentId).catch(() => {});
// After:
    rd.deleteTorrent(activeDownload.torrentId).catch(err => console.warn(`[pipeline] Failed to delete RD torrent ${activeDownload.torrentId}: ${err.message}`));
```

**Line 83** — SSE write error (inside `send()` function):
```javascript
// Before:
    } catch {}
// After:
    } catch (err) { console.warn(`[pipeline] SSE write failed: ${err.message}`); }
```

**Lines 295-296** — Cover art pre-warm (foreground):
```javascript
// Before:
      fetch(warmUrl, { signal: AbortSignal.timeout(10000) }).catch(() => {});
    } catch {}
// After:
      fetch(warmUrl, { signal: AbortSignal.timeout(10000) }).catch(err => console.warn(`[pipeline] Cover pre-warm failed: ${err.message}`));
    } catch (err) { console.warn(`[pipeline] Cover pre-warm setup error: ${err.message}`); }
```

**Line 430** — Metadata write (background):
```javascript
// Before:
        try { fs.writeFileSync(path.join(destDir, '.metadata.json'), JSON.stringify({ mbid, coverArt, year, source: 'torrent' }, null, 2)); } catch {}
// After:
        try { fs.writeFileSync(path.join(destDir, '.metadata.json'), JSON.stringify({ mbid, coverArt, year, source: 'torrent' }, null, 2)); } catch (err) { console.warn(`[bg-pipeline] Failed to write .metadata.json: ${err.message}`); }
```

**Line 434** — Cover art pre-warm (background):
```javascript
// Before:
      try { fetch(`http://localhost:3000/api/cover/search?artist=${encodeURIComponent(destArtist)}&album=${encodeURIComponent(destAlbum)}`, { signal: AbortSignal.timeout(10000) }).catch(() => {}); } catch {}
// After:
      try { fetch(`http://localhost:3000/api/cover/search?artist=${encodeURIComponent(destArtist)}&album=${encodeURIComponent(destAlbum)}`, { signal: AbortSignal.timeout(10000) }).catch(err => console.warn(`[bg-pipeline] Cover pre-warm failed: ${err.message}`)); } catch (err) { console.warn(`[bg-pipeline] Cover pre-warm setup error: ${err.message}`); }
```

- [ ] **Step 2: Run existing pipeline tests**

Run: `cd packages/server && npx jest --testPathPattern=pipeline --no-cache`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/api/pipeline.js
git commit -m "fix: replace silent catches with logged warnings in pipeline (E3)"
```

---

### Task 4: Check for ENOENT specifically in youtube.js (E4)

**Files:**
- Modify: `packages/server/src/api/youtube.js:213`
- Create: `packages/server/__tests__/api/youtube-enoent.test.js`

**Context:** At line 213, the catch block `catch { /* dir doesn't exist yet */ }` swallows all errors when checking if a track already exists in the destination directory. If the error is a permission denied or I/O error (not ENOENT), it should be logged rather than silently ignored.

- [ ] **Step 1: Write failing test**

```javascript
// packages/server/__tests__/api/youtube-enoent.test.js
'use strict';

const fs = require('fs');

test('ENOENT error has code property', () => {
  try {
    fs.readdirSync('/nonexistent-path-for-test-12345');
  } catch (err) {
    expect(err.code).toBe('ENOENT');
  }
});

test('EACCES error has different code', () => {
  // This validates our approach — EACCES !== ENOENT
  expect('EACCES').not.toBe('ENOENT');
});
```

- [ ] **Step 2: Run test to verify baseline**

Run: `cd packages/server && npx jest __tests__/api/youtube-enoent.test.js --no-cache`
Expected: PASS

- [ ] **Step 3: Fix the catch block**

In `packages/server/src/api/youtube.js` line 213, change:
```javascript
    } catch { /* dir doesn't exist yet */ }
```
to:
```javascript
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`[youtube] Error checking existing tracks in ${destDir}: ${err.message}`);
      }
    }
```

- [ ] **Step 4: Run existing youtube tests**

Run: `cd packages/server && npx jest --testPathPattern=youtube --no-cache`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/api/youtube.js packages/server/__tests__/api/youtube-enoent.test.js
git commit -m "fix: check for ENOENT specifically in youtube track-exists check (E4)"
```

---

### Task 5: Add logging to empty catches in search.js (E5)

**Files:**
- Modify: `packages/server/src/api/search.js:370, 389, 423, 626-627, 700`

**Context:** Several empty `catch {}` blocks in search.js silently swallow errors from MusicBrainz API calls, recording searches, and cover art prefetch. These should log at warn level to aid debugging when MB is down or returns unexpected responses.

- [ ] **Step 1: Add logging to each empty catch**

In `packages/server/src/api/search.js`:

**Line 370** — Compound artist MB search fallback:
```javascript
// Before:
        } catch {}
// After:
        } catch (err) { console.warn(`[search] Compound artist search error: ${err.message}`); }
```

**Line 389** — Fuzzy search fallback:
```javascript
// Before:
        } catch {}
// After:
        } catch (err) { console.warn(`[search] Fuzzy search error: ${err.message}`); }
```

**Line 423** — Recording search:
```javascript
// Before:
          } catch {}
// After:
          } catch (err) { console.warn(`[search] Recording search error: ${err.message}`); }
```

**Lines 626-627** — YouTube/SoundCloud search (already has `.catch(() => [])` which returns empty array on failure — this is acceptable because the outer catch at 649 logs the error. The `.catch(() => [])` prevents Promise.all from rejecting when one source fails. No change needed here.)

**Line 700** — Cover art prefetch:
```javascript
// Before:
        Promise.all(Array.from({ length: Math.min(concurrency, coverUrls.length) }, fetchNext)).catch(() => {});
// After:
        Promise.all(Array.from({ length: Math.min(concurrency, coverUrls.length) }, fetchNext)).catch(err => console.warn(`[search] Cover prefetch batch error: ${err.message}`));
```

**Line 697** — Cover fetch miss file write:
```javascript
// Before:
            } catch { fs.writeFileSync(missFile, ''); }
// After:
            } catch (err) {
              console.warn(`[search] Cover fetch failed for ${url}: ${err.message}`);
              try { fs.writeFileSync(missFile, ''); } catch {}
            }
```

- [ ] **Step 2: Run existing search tests**

Run: `cd packages/server && npx jest --testPathPattern=search --no-cache`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/api/search.js
git commit -m "fix: replace silent catches with logged warnings in search (E5)"
```

---

### Task 6: Add try-catch around JSON.parse in job-processor.js (E6)

**Files:**
- Modify: `packages/server/src/services/job-processor.js:846`
- Create: `packages/server/__tests__/services/job-processor-parse.test.js`

**Context:** At line 846, `JSON.parse(job.payload)` is called without a try-catch. If the payload is corrupted or not valid JSON, this throws an unhandled error that crashes the job worker. The fix is to wrap it in try-catch and mark the job as failed with a clear error message.

- [ ] **Step 1: Write failing test**

```javascript
// packages/server/__tests__/services/job-processor-parse.test.js
'use strict';

// Mock all dependencies that job-processor imports
jest.mock('../../src/services/realdebrid', () => ({}));
jest.mock('../../src/services/downloader', () => ({}));
jest.mock('../../src/services/file-validator', () => ({}));
jest.mock('../../src/services/download-validator', () => ({}));
jest.mock('../../src/services/activity-log', () => ({ log: jest.fn() }));
jest.mock('../../src/services/soulseek', () => ({ enqueueDownload: jest.fn(), pollDownloads: jest.fn() }));
jest.mock('../../src/services/library-check', () => ({ probeFile: jest.fn(), isUpgrade: jest.fn(), QUALITY_RANK: {} }));
jest.mock('../../src/services/db', () => ({
  getGlobalSetting: jest.fn(),
  setGlobalSetting: jest.fn(),
}));

const { process: processJob } = require('../../src/services/job-processor');

test('rejects gracefully when payload is invalid JSON string', async () => {
  const job = { id: 99, type: 'download', payload: '{invalid json!!!' };
  await expect(processJob(job)).rejects.toThrow();
});

test('handles object payload without parsing', async () => {
  const job = { id: 100, type: 'unknown-type', payload: { artist: 'Test' } };
  const result = await processJob(job);
  expect(result.skipped).toBe(true);
});
```

- [ ] **Step 2: Run test to verify first test shows unhandled JSON parse error**

Run: `cd packages/server && npx jest __tests__/services/job-processor-parse.test.js --no-cache`
Expected: First test PASSES (it expects a throw), second test PASSES. But the first test throws an ugly SyntaxError, not a descriptive error.

- [ ] **Step 3: Add try-catch around JSON.parse**

In `packages/server/src/services/job-processor.js` line 846, change:
```javascript
  const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
```
to:
```javascript
  let payload;
  if (typeof job.payload === 'string') {
    try {
      payload = JSON.parse(job.payload);
    } catch (parseErr) {
      activityLog.log('pipeline', 'error', `[job ${job.id}] Invalid JSON payload: ${parseErr.message}`);
      throw new Error(`Job ${job.id} has invalid JSON payload: ${parseErr.message}`);
    }
  } else {
    payload = job.payload;
  }
```

- [ ] **Step 4: Update test to verify descriptive error message**

Update the first test:
```javascript
test('rejects with descriptive error when payload is invalid JSON', async () => {
  const job = { id: 99, type: 'download', payload: '{invalid json!!!' };
  await expect(processJob(job)).rejects.toThrow(/Job 99 has invalid JSON payload/);
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/server && npx jest __tests__/services/job-processor-parse.test.js --no-cache`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/job-processor.js packages/server/__tests__/services/job-processor-parse.test.js
git commit -m "fix: add try-catch around JSON.parse in job processor (E6)"
```

---

### Task 7: Log audio.play() errors in usePlayer.js (E7)

**Files:**
- Modify: `packages/client/src/hooks/usePlayer.js:185`

**Context:** `audio.play().catch(() => {})` silently swallows all play errors. While `NotAllowedError` (autoplay policy) is expected and harmless, other errors like `NotSupportedError` (corrupt file) or `AbortError` (src changed mid-load) are useful for debugging playback issues. Fix: log the error, filtering out the expected autoplay case.

- [ ] **Step 1: Replace empty catch with logged catch**

In `packages/client/src/hooks/usePlayer.js` line 185, change:
```javascript
      audioRef.current.play().catch(() => {});
```
to:
```javascript
      audioRef.current.play().catch(err => {
        if (err.name !== 'AbortError') {
          console.warn(`[player] play() failed: ${err.name} — ${err.message}`);
        }
      });
```

`AbortError` is filtered because it fires routinely when switching tracks quickly (the previous play is aborted by the new src assignment). `NotAllowedError` (autoplay policy) is still logged because it indicates the user needs to interact before audio works — useful context.

- [ ] **Step 2: Verify by manual testing**

1. Open app, play a track — should play normally, no console warnings
2. Rapidly click between tracks — should not spam warnings (AbortError filtered)
3. If a corrupt file is encountered, should log a warning

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/hooks/usePlayer.js
git commit -m "fix: log audio.play() errors except AbortError in usePlayer (E7)"
```

---

### Task 8: Add SSE connection status logging in useRecentlyPlayed.js (E8)

**Files:**
- Modify: `packages/client/src/hooks/useRecentlyPlayed.js:41`

**Context:** SSE errors are silently caught and trigger a reconnect (line 41: `.catch(() => { if (!abort.signal.aborted) scheduleReconnect(); })`). This is correct behavior for resilience, but there's no logging when the connection fails, making it hard to diagnose why recently-played data isn't syncing across devices. Fix: add a console.warn before reconnecting.

- [ ] **Step 1: Add logging before reconnect**

In `packages/client/src/hooks/useRecentlyPlayed.js` line 41, change:
```javascript
        .catch(() => { if (!abort.signal.aborted) scheduleReconnect(); });
```
to:
```javascript
        .catch(err => {
          if (!abort.signal.aborted) {
            console.warn(`[recently-played] SSE connection lost, reconnecting in 3s: ${err.message || 'unknown'}`);
            scheduleReconnect();
          }
        });
```

Also add logging to the reader error handler at line 37:
```javascript
// Before:
            }).catch(() => scheduleReconnect());
// After:
            }).catch(err => {
              if (!abort.signal.aborted) {
                console.warn(`[recently-played] SSE read error, reconnecting: ${err.message || 'unknown'}`);
              }
              scheduleReconnect();
            });
```

- [ ] **Step 2: Verify by manual testing**

1. Open app with devtools console open
2. Stop the server — should see "SSE connection lost, reconnecting in 3s" warnings
3. Restart the server — should reconnect and stop warning
4. During normal operation — should have no warnings

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/hooks/useRecentlyPlayed.js
git commit -m "fix: log SSE connection errors in useRecentlyPlayed (E8)"
```
