# Soulseek Pipeline Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Soulseek (via slskd) into the acquisition pipeline as a third source alongside ApiBay and SolidTorrents, with its own download job type that downloads directly from Soulseek peers (bypassing Real-Debrid).

**Architecture:** Soulseek integration has two parts: (1) add `searchSoulseekCascade` to the `searchForUpgrade` multi-source search, and (2) add a new `soulseek-download` job type that uses slskd's transfer API to download files from peers, poll for completion, then run the existing validation + library-move pipeline. The not-ify and slskd containers share a Docker volume for file access.

**Tech Stack:** Node.js, slskd REST API (`/api/v0/transfers/downloads/{username}`), Docker shared volumes, Jest

---

## Background

### Current Pipeline Flow
```
upgrade job → searchForUpgrade() → [ApiBay, SolidTorrents] → score/rank → download job
download job → RD addMagnet → poll → selectFiles → download → validate → library
```

### Target Pipeline Flow
```
upgrade job → searchForUpgrade() → [ApiBay, SolidTorrents, Soulseek] → score/rank → download job OR soulseek-download job
download job → (unchanged, RD path)
soulseek-download job → slskd enqueue → poll transfers → copy from shared volume → validate → library
```

### Key Files
- `packages/server/src/services/soulseek.js` — slskd API wrapper (search cascade already implemented)
- `packages/server/src/services/search.js` — `searchForUpgrade()` orchestrates multi-source search
- `packages/server/src/services/job-processor.js` — dispatches jobs by type
- `packages/server/src/services/job-queue.js` — SQLite job queue
- `packages/server/src/services/downloader.js` — file download, extraction, audio detection
- `packages/server/src/services/file-validator.js` — MIME + ffprobe + ClamAV validation
- `packages/server/src/services/download-validator.js` — MusicBrainz track matching
- `docker-compose.dev.yml` — slskd container config

### slskd Download API
- **Enqueue:** `POST /api/v0/transfers/downloads/{username}` body: `[{filename, size}]`
- **List:** `GET /api/v0/transfers/downloads` — returns all active/completed transfers
- **Get user transfers:** `GET /api/v0/transfers/downloads/{username}` — returns transfers for a user
- **Downloads dir:** `/app/downloads` inside slskd container (on `slskd_data` volume)
- **Files API:** `GET /api/v0/files/downloads` — browse downloaded files directory

---

## Phase 1: Docker Volume Sharing

### Task 1: Share slskd downloads with not-ify via bind mount

The not-ify container needs read access to slskd's downloaded files. The current `slskd_data:/app` volume owns slskd's entire app directory including `/app/downloads`. We use a **bind mount** to avoid shadowing the existing named volume.

**Important:** Soulseek is dev/staging only for now — not added to `docker-compose.yml` (base). Staging will get its own slskd service later. Production does not use Soulseek.

**Files:**
- Modify: `docker-compose.dev.yml`

- [ ] **Step 1: Add bind mount for slskd downloads**

In `docker-compose.dev.yml`:

```yaml
# In services.slskd.volumes, add:
- ./slskd-downloads:/app/downloads

# In services.not-ify.volumes, add:
- ./slskd-downloads:/app/slskd-downloads:ro

# In services.not-ify.environment, add:
- SLSKD_DOWNLOADS_DIR=/app/slskd-downloads
```

Both containers share the `./slskd-downloads` host directory. slskd writes to it, not-ify reads from it. No named volume conflict.

- [ ] **Step 2: Verify volume sharing works**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d slskd not-ify
docker exec notify-slskd-1 sh -c "echo test > /app/downloads/test.txt"
docker exec notify-not-ify-1 sh -c "cat /app/slskd-downloads/test.txt"
docker exec notify-slskd-1 sh -c "rm /app/downloads/test.txt"
```

Expected: "test" printed from the not-ify container.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.dev.yml
git commit -m "feat(docker): share slskd downloads volume with not-ify container"
```

---

## Phase 2: Soulseek Download Service

### Task 2: Add download functions to soulseek.js

Extend `packages/server/src/services/soulseek.js` with functions to enqueue downloads on slskd and poll for completion.

**Files:**
- Modify: `packages/server/src/services/soulseek.js`
- Create: `packages/server/__tests__/services/soulseek.test.js`

- [ ] **Step 1: Write failing tests for download functions**

Create `packages/server/__tests__/services/soulseek.test.js`:

```javascript
'use strict';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Set env before require
process.env.SLSKD_URL = 'http://localhost:5030';

const { enqueueDownload, pollDownloads, getDownloadedFiles } = require('../../src/services/soulseek');

describe('soulseek download functions', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('enqueueDownload', () => {
    test('POSTs files to slskd transfer endpoint', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      await enqueueDownload('some_user', [
        { filename: '\\\\music\\\\Artist\\\\Album\\\\01.flac', size: 30000000 },
      ]);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5030/api/v0/transfers/downloads/some_user',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(String),
        })
      );
    });

    test('returns false on API error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
      const result = await enqueueDownload('user', []);
      expect(result).toBe(false);
    });
  });

  describe('pollDownloads', () => {
    test('returns transfer state for a username', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { username: 'some_user', directories: [
            { directory: 'Album', files: [
              { filename: '01.flac', state: 'Completed, Succeeded', size: 30000000 }
            ]}
          ]}
        ],
      });

      const result = await pollDownloads('some_user');
      expect(result).toHaveLength(1);
      expect(result[0].directories[0].files[0].state).toContain('Succeeded');
    });
  });

  describe('getDownloadedFiles', () => {
    test('lists files from slskd downloads directory via API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { name: 'Artist - Album', files: [
            { name: '01.flac', size: 30000000 },
            { name: '02.flac', size: 28000000 },
          ]}
        ],
      });

      const files = await getDownloadedFiles();
      expect(files).toBeDefined();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest packages/server/__tests__/services/soulseek.test.js --no-cache
```

Expected: FAIL — `enqueueDownload`, `pollDownloads`, `getDownloadedFiles` are not exported.

- [ ] **Step 3: Implement download functions in soulseek.js**

Add to `packages/server/src/services/soulseek.js`:

```javascript
/**
 * Enqueue files for download from a Soulseek user via slskd.
 * @param {string} username - Soulseek username
 * @param {Array<{filename: string, size: number}>} files - Files to download
 * @returns {Promise<boolean>} true if enqueued successfully
 */
async function enqueueDownload(username, files) {
  try {
    const res = await fetch(`${SLSKD_URL}/api/v0/transfers/downloads/${encodeURIComponent(username)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(files),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error(`[soulseek] Enqueue download failed: ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[soulseek] Enqueue error: ${err.message}`);
    return false;
  }
}

/**
 * Get download transfer status for a specific user.
 * @param {string} username
 * @returns {Promise<Array>} Transfer records from slskd
 */
async function pollDownloads(username) {
  try {
    const res = await fetch(
      `${SLSKD_URL}/api/v0/transfers/downloads/${encodeURIComponent(username)}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

/**
 * Browse downloaded files in slskd's downloads directory.
 * @returns {Promise<Array>} Directory listing from slskd
 */
async function getDownloadedFiles() {
  try {
    const res = await fetch(`${SLSKD_URL}/api/v0/files/downloads`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}
```

Update `module.exports` to include all new functions.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest packages/server/__tests__/services/soulseek.test.js --no-cache
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/soulseek.js packages/server/__tests__/services/soulseek.test.js
git commit -m "feat(soulseek): add download enqueue, poll, and file listing functions"
```

---

## Phase 3: Add Soulseek to Multi-Source Search

### Task 3: Wire searchSoulseekCascade into searchForUpgrade

Add Soulseek results alongside torrent results in `searchForUpgrade()`. Soulseek results have a different shape — they return individual files from users, not magnet links. The search function needs to normalize Soulseek results into a common format, with `source: 'soulseek'` and user/file metadata instead of a magnet link.

**Files:**
- Modify: `packages/server/src/services/search.js`
- Modify: `packages/server/__tests__/api/search.test.js` (if search-related tests exist)
- Create: `packages/server/__tests__/services/search-upgrade.test.js`

- [ ] **Step 1: Write failing test for Soulseek in searchForUpgrade**

Create `packages/server/__tests__/services/search-upgrade.test.js`:

```javascript
'use strict';

jest.mock('../../src/services/proxy', () => ({
  getProxyFetch: () => fetch,
  recordFailure: jest.fn(),
}));

jest.mock('../../src/services/llm', () => ({
  checkHealth: async () => false,
  prompt: async () => null,
}));

const mockSearchSoulseekCascade = jest.fn();
jest.mock('../../src/services/soulseek', () => ({
  searchSoulseekCascade: (...a) => mockSearchSoulseekCascade(...a),
  checkHealth: async () => true,
}));

const mockSearchSolidTorrents = jest.fn().mockResolvedValue([]);
jest.mock('../../src/services/solidtorrents', () => ({
  searchSolidTorrents: (...a) => mockSearchSolidTorrents(...a),
}));

// Mock fetch for ApiBay
global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: async () => [{ id: '0', name: 'No results returned' }],
});

const { searchForUpgrade } = require('../../src/services/search');

describe('searchForUpgrade with Soulseek', () => {
  beforeEach(() => jest.clearAllMocks());

  test('includes Soulseek results when torrents find nothing', async () => {
    mockSearchSoulseekCascade.mockResolvedValue({
      strategy: 'artist-only',
      responseCount: 5,
      fileCount: 42,
      responses: [{
        username: 'musicfan99',
        hasFreeSlot: true,
        speed: 5000000,
        files: [
          { filename: '\\\\music\\\\Artist\\\\Album\\\\01 Track.flac', size: 30000000, bitRate: 1411, sampleRate: 44100, bitDepth: 16 },
          { filename: '\\\\music\\\\Artist\\\\Album\\\\02 Track.flac', size: 28000000, bitRate: 1411, sampleRate: 44100, bitDepth: 16 },
        ],
      }],
    });

    const result = await searchForUpgrade({ artist: 'Artist', album: 'Album' });
    expect(result).not.toBeNull();
    expect(result.source).toBe('soulseek');
    expect(result.soulseekUser).toBe('musicfan99');
    expect(result.files.length).toBe(2);
  });

  test('prefers torrent results over Soulseek when both exist', async () => {
    // Mock a torrent hit
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [{
        id: '123', name: 'Artist Album FLAC', info_hash: 'abc123',
        seeders: '50', leechers: '5', size: '500000000',
      }],
    });

    mockSearchSoulseekCascade.mockResolvedValue({
      strategy: 'exact',
      responseCount: 1,
      fileCount: 10,
      responses: [{
        username: 'user1',
        hasFreeSlot: true,
        speed: 1000000,
        files: [{ filename: 'track.flac', size: 30000000, bitRate: 1411 }],
      }],
    });

    const result = await searchForUpgrade({ artist: 'Artist', album: 'Album' });
    // Torrent with 50 seeders should outscore single Soulseek user
    expect(result).not.toBeNull();
    expect(result.magnetLink).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest packages/server/__tests__/services/search-upgrade.test.js --no-cache
```

Expected: FAIL — Soulseek not called in searchForUpgrade.

- [ ] **Step 3: Implement Soulseek search in searchForUpgrade**

In `packages/server/src/services/search.js`, modify `searchForUpgrade()`:

1. Import soulseek at the top: `const { searchSoulseekCascade, checkHealth: slskHealth } = require('./soulseek');`
2. **Move the early-return check** (`if (allResults.length === 0) return null;` at line 223) to AFTER the Soulseek search block. The current code returns null before Soulseek is ever reached. Move it to after step 3 below.
3. After the torrent search loop (but before the moved early-return), add a Soulseek search:

```javascript
// Soulseek search (parallel with torrent queries is not needed — cascade is sequential)
try {
  const slskHealthy = await slskHealth();
  if (slskHealthy) {
    const slskResult = await searchSoulseekCascade(artist, album, { timeout: 15000 });
    if (slskResult.responseCount > 0) {
      // Pick best user: prefer free slots, high speed, FLAC files
      const bestUser = pickBestSoulseekUser(slskResult.responses, artist, album);
      if (bestUser) {
        allResults.push({
          id: `slsk_${bestUser.username}_${Date.now()}`,
          name: `${artist} - ${album} [Soulseek: ${bestUser.username}]`,
          seeders: bestUser.hasFreeSlot ? 10 : 1, // normalize for scoring
          source: 'soulseek',
          soulseekUser: bestUser.username,
          files: bestUser.files,
          hasFreeSlot: bestUser.hasFreeSlot,
          speed: bestUser.speed,
        });
      }
    }
  }
} catch (err) {
  console.error(`[search] Soulseek search failed: ${err.message}`);
}
```

3. Add `pickBestSoulseekUser` function that filters users by:
   - Has FLAC files (or target quality files)
   - Has enough files to plausibly be the full album (>=3 audio files in same directory)
   - Prefers free upload slots
   - Prefers higher upload speed

4. When scoring, Soulseek results get `source: 'soulseek'` so the job processor knows to use the soulseek download path.

5. Modify the `searchForUpgrade` return: if best result is Soulseek, return the user/files metadata instead of magnetLink:

```javascript
if (best.source === 'soulseek') {
  return {
    source: 'soulseek',
    name: best.name,
    score: best.score,
    soulseekUser: best.soulseekUser,
    files: best.files,
    hasFreeSlot: best.hasFreeSlot,
    isDiscography: false,
  };
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest packages/server/__tests__/services/search-upgrade.test.js --no-cache
```

Expected: PASS

- [ ] **Step 5: Run full test suite**

```bash
npm test --prefix packages/server
```

Expected: All existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/search.js packages/server/__tests__/services/search-upgrade.test.js
git commit -m "feat(search): add Soulseek as third source in searchForUpgrade"
```

---

## Phase 4: Soulseek Download Job Type

### Task 4: Add processSoulseekDownload to job-processor

The `soulseek-download` job type: enqueue files on slskd → poll until complete → copy from shared volume → validate → move to library.

**Files:**
- Modify: `packages/server/src/services/job-processor.js`
- Modify: `packages/server/__tests__/services/job-processor.test.js`

- [ ] **Step 1: Write failing test for soulseek-download job type**

Add to `packages/server/__tests__/services/job-processor.test.js`:

```javascript
// Add mocks at top of file:
const mockEnqueueDownload = jest.fn();
const mockPollDownloads = jest.fn();
jest.mock('../../src/services/soulseek', () => ({
  enqueueDownload: (...a) => mockEnqueueDownload(...a),
  pollDownloads: (...a) => mockPollDownloads(...a),
}));

// Add test:
test('processes soulseek-download job end-to-end', async () => {
  const job = {
    id: 10,
    type: 'soulseek-download',
    payload: JSON.stringify({
      artist: 'Daft Punk',
      album: 'Discovery',
      soulseekUser: 'musicfan99',
      files: [
        { filename: '\\music\\Daft Punk\\Discovery\\01 One More Time.flac', size: 35000000 },
        { filename: '\\music\\Daft Punk\\Discovery\\02 Aerodynamic.flac', size: 30000000 },
      ],
    }),
  };

  mockEnqueueDownload.mockResolvedValue(true);
  mockPollDownloads.mockResolvedValueOnce([{
    username: 'musicfan99',
    directories: [{
      directory: 'Discovery',
      files: [
        { filename: '01 One More Time.flac', state: 'Completed, Succeeded', size: 35000000 },
        { filename: '02 Aerodynamic.flac', state: 'Completed, Succeeded', size: 30000000 },
      ],
    }],
  }]);

  // Mock fs to simulate files existing in shared volume
  fs.existsSync.mockImplementation((p) => {
    if (p.includes('slskd-downloads')) return true;
    return false;
  });
  fs.readdirSync.mockReturnValue(['01 One More Time.flac', '02 Aerodynamic.flac']);
  fs.copyFileSync = jest.fn();

  mockValidateFile.mockResolvedValue({ passed: true, checks: [] });
  mockDownloadValidate.mockResolvedValue({ score: 0.05, confidence: 'high', details: 'ok' });

  const result = await processJob(job);
  expect(result.success).toBe(true);
  expect(result.files).toBe(2);
  expect(mockEnqueueDownload).toHaveBeenCalledWith('musicfan99', expect.any(Array));
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest packages/server/__tests__/services/job-processor.test.js -t "soulseek-download" --no-cache
```

Expected: FAIL — unknown job type.

- [ ] **Step 3: Implement processSoulseekDownload**

Add to `packages/server/src/services/job-processor.js`:

```javascript
const { enqueueDownload, pollDownloads } = require('./soulseek');

const SLSKD_DOWNLOADS_DIR = process.env.SLSKD_DOWNLOADS_DIR || '/app/slskd-downloads';
const SLSK_DOWNLOAD_TIMEOUT = parseInt(process.env.SLSK_DOWNLOAD_TIMEOUT || '1800000', 10); // 30 minutes default
const SLSK_POLL_INTERVAL = 5000; // 5 seconds

/**
 * Process a Soulseek download job:
 * enqueue on slskd → poll until complete → copy from shared volume → validate → library
 */
async function processSoulseekDownload(job, payload) {
  const { soulseekUser, files, artist, album, mbid, rgid } = payload;
  const stagingDir = path.join(getStagingDir(), downloader.sanitizePath(artist), downloader.sanitizePath(album));

  try {
    // Step 1: Enqueue download on slskd
    log('pipeline', 'info', `[job ${job.id}] Enqueuing ${files.length} files from Soulseek user ${soulseekUser}`);
    const enqueued = await enqueueDownload(soulseekUser, files);
    if (!enqueued) {
      throw new Error(`Failed to enqueue download from ${soulseekUser}`);
    }

    // Step 2: Poll until all files complete or timeout
    const deadline = Date.now() + SLSK_DOWNLOAD_TIMEOUT;
    let allComplete = false;

    while (Date.now() < deadline && !allComplete) {
      await new Promise(r => setTimeout(r, SLSK_POLL_INTERVAL));
      const transfers = await pollDownloads(soulseekUser);

      // Check if all our files have completed
      // Key by basename since enqueued filenames use full remote paths but
      // transfer status may report different path formats
      const getBasename = (f) => f.split(/[\\/]/).pop();
      const fileStates = new Map();
      for (const t of transfers) {
        for (const dir of (t.directories || [])) {
          for (const f of (dir.files || [])) {
            fileStates.set(getBasename(f.filename), f.state || '');
          }
        }
      }

      const completed = files.filter(f => {
        const state = fileStates.get(getBasename(f.filename)) || '';
        return state.includes('Succeeded');
      });

      const failed = files.filter(f => {
        const state = fileStates.get(getBasename(f.filename)) || '';
        return state.includes('Errored') || state.includes('Cancelled');
      });

      if (failed.length > 0) {
        throw new Error(`${failed.length} files failed to download from ${soulseekUser}`);
      }

      allComplete = completed.length >= files.length;
      if (!allComplete) {
        log('pipeline', 'info', `[job ${job.id}] Soulseek download progress: ${completed.length}/${files.length}`);
      }
    }

    if (!allComplete) {
      throw new Error(`Soulseek download timed out after ${SLSK_DOWNLOAD_TIMEOUT / 1000}s`);
    }

    // Step 3: Copy files from shared volume to staging
    fs.mkdirSync(stagingDir, { recursive: true });
    const downloadedFiles = [];

    // Find the files in the slskd downloads directory
    // slskd organizes downloads as: /downloads/{username}/{directory}/{file}
    const userDir = path.join(SLSKD_DOWNLOADS_DIR, soulseekUser);
    if (!fs.existsSync(userDir)) {
      throw new Error(`Soulseek downloads directory not found: ${userDir}`);
    }

    // Walk the user's download directory for audio files
    // SECURITY: use path.basename() to strip directory components from Soulseek filenames
    // to prevent path traversal attacks from untrusted peer filenames
    const walkDir = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (downloader.isAudioFile(entry.name)) {
          const safeName = path.basename(entry.name); // strip any directory traversal
          const destPath = path.join(stagingDir, downloader.sanitizePath(safeName));
          fs.copyFileSync(fullPath, destPath);
          downloadedFiles.push(destPath);
        }
      }
    };
    walkDir(userDir);

    if (downloadedFiles.length === 0) {
      throw new Error('No audio files found in Soulseek download');
    }

    log('pipeline', 'info', `[job ${job.id}] Copied ${downloadedFiles.length} files from Soulseek to staging`);

    // Step 4: File validation (same as torrent path)
    for (const filePath of downloadedFiles) {
      const validation = await fileValidator.validateFile(filePath);
      if (!validation.passed) {
        const failedChecks = validation.checks.filter(c => !c.passed && !c.skipped).map(c => c.name).join(', ');
        throw new Error(`File validation failed for ${path.basename(filePath)}: ${failedChecks}`);
      }
    }
    log('pipeline', 'info', `[job ${job.id}] All ${downloadedFiles.length} files passed validation`);

    // Step 5: Download validation (MusicBrainz track matching)
    const existingDir = path.join(getMusicDir(), downloader.sanitizePath(artist), downloader.sanitizePath(album));
    let existingTrackCount;
    try {
      if (fs.existsSync(existingDir)) {
        existingTrackCount = fs.readdirSync(existingDir).filter(f => downloader.isAudioFile(f)).length;
      }
    } catch { /* no existing files */ }

    const validation = await downloadValidator.validate({
      files: downloadedFiles,
      mbid, rgid, artist, album, existingTrackCount,
    });

    log('pipeline', 'info', `[job ${job.id}] Validation: ${validation.confidence} confidence (score ${validation.score})`);

    if (validation.confidence === 'low') {
      throw new Error(`Download validation failed (score ${validation.score}): ${validation.details}`);
    }

    // Step 6: Move from staging to library
    const destDir = path.join(getMusicDir(), downloader.sanitizePath(artist), downloader.sanitizePath(album));
    fs.mkdirSync(destDir, { recursive: true });
    for (const filePath of downloadedFiles) {
      const destPath = path.join(destDir, path.basename(filePath));
      fs.renameSync(filePath, destPath);
    }

    log('pipeline', 'success', `[job ${job.id}] ${artist} - ${album}: ${downloadedFiles.length} files from Soulseek (${validation.confidence} confidence)`);

    return {
      success: true,
      source: 'soulseek',
      artist, album,
      files: downloadedFiles.length,
      confidence: validation.confidence,
      score: validation.score,
      soulseekUser,
    };
  } finally {
    // Cleanup staging
    try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch {}
  }
}
```

Add to the `process()` switch:

```javascript
case 'soulseek-download':
  return processSoulseekDownload(job, payload);
```

- [ ] **Step 4: Run tests**

```bash
npx jest packages/server/__tests__/services/job-processor.test.js --no-cache
```

Expected: All pass, including new soulseek-download test.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/job-processor.js packages/server/__tests__/services/job-processor.test.js
git commit -m "feat(pipeline): add soulseek-download job type to processor"
```

---

### Task 5: Wire upgrade job to enqueue soulseek-download jobs

When `processUpgrade` finds a Soulseek source (result has `source: 'soulseek'`), it should enqueue a `soulseek-download` job instead of a `download` job.

**Files:**
- Modify: `packages/server/src/services/job-processor.js` (the `processUpgrade` function)
- Modify: `packages/server/__tests__/services/job-processor.test.js`

- [ ] **Step 1: Write failing test**

```javascript
test('processUpgrade enqueues soulseek-download when source is soulseek', async () => {
  const job = { id: 20, type: 'upgrade', payload: JSON.stringify({ artist: 'Artist', album: 'Album' }) };

  // Mock searchForUpgrade to return a Soulseek result
  const mockSearchForUpgrade = jest.fn().mockResolvedValue({
    source: 'soulseek',
    name: 'Artist - Album [Soulseek: user1]',
    score: 0.85,
    soulseekUser: 'user1',
    files: [{ filename: 'track.flac', size: 30000000 }],
  });
  jest.doMock('../../src/services/search', () => ({
    searchForUpgrade: mockSearchForUpgrade,
  }));

  const result = await processJob(job);
  expect(result.success).toBe(true);
  // Verify a soulseek-download job was enqueued (check jobQueue mock)
});
```

- [ ] **Step 2: Implement**

In `processUpgrade`, after `searchForUpgrade` returns a result, check `result.source`:

```javascript
if (result.source === 'soulseek') {
  const downloadJobId = jobQueue.enqueue(
    'soulseek-download',
    {
      soulseekUser: result.soulseekUser,
      files: result.files,
      artist, album,
      mbid: payload.mbid,   // pass through for download validation
      rgid: payload.rgid,   // pass through for download validation
      source_meta: { source: 'soulseek', name: result.name, score: result.score },
    },
    { dedupeKey: `slsk-dl:${artist}|${album}`, priority: 5 }
  );
  log('pipeline', 'info', `[job ${job.id}] Enqueued soulseek-download job ${downloadJobId}`);
  return { success: true, downloadJobId, source: result.name, score: result.score };
}
```

- [ ] **Step 3: Run tests**

```bash
npx jest packages/server/__tests__/services/job-processor.test.js --no-cache
```

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/job-processor.js packages/server/__tests__/services/job-processor.test.js
git commit -m "feat(pipeline): upgrade job routes Soulseek results to soulseek-download jobs"
```

---

## Phase 5: Cleanup and Verification

### Task 6: slskd download directory cleanup

After a successful soulseek-download job, clean up the files from slskd's downloads directory to avoid disk bloat.

**Files:**
- Modify: `packages/server/src/services/soulseek.js`
- Modify: `packages/server/src/services/job-processor.js`

- [ ] **Step 1: Add cleanup to processSoulseekDownload's finally block**

Clean up via filesystem (shared bind mount) rather than unverified slskd API endpoint. Add to the `finally` block in `processSoulseekDownload`:

```javascript
// Cleanup slskd downloads for this user (via shared bind mount)
const slskdUserDir = path.join(SLSKD_DOWNLOADS_DIR, soulseekUser);
try { fs.rmSync(slskdUserDir, { recursive: true, force: true }); } catch {}
```

This is safe because `SLSKD_DOWNLOADS_DIR` points to the bind-mounted directory, and we only delete the specific user's subdirectory.

- [ ] **Step 3: Write test, run tests**

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/soulseek.js packages/server/src/services/job-processor.js
git commit -m "feat(soulseek): clean up slskd downloads after successful library import"
```

---

### Task 7: Post-download integration (metadata, cover art, no-downgrade guard)

The existing torrent pipeline has several post-download steps that `processSoulseekDownload` must also perform. Without these, Soulseek downloads will be second-class citizens in the library.

**Files:**
- Modify: `packages/server/src/services/job-processor.js`
- Modify: `packages/server/src/services/job-worker.js`
- Modify: `packages/server/__tests__/services/job-processor.test.js`

- [ ] **Step 1: Add `.metadata.json` writing to processSoulseekDownload**

After the library move (Step 6 in the processor), write metadata so the library scanner picks up MusicBrainz IDs and source info:

```javascript
// Step 7: Write .metadata.json (matches foreground pipeline behavior)
const metadataPath = path.join(destDir, '.metadata.json');
try {
  fs.writeFileSync(metadataPath, JSON.stringify({
    mbid: mbid || null,
    source: 'soulseek',
    soulseekUser,
    importedAt: new Date().toISOString(),
  }));
} catch {}
```

Add this right after the file move loop and before the success log.

- [ ] **Step 2: Add cover art pre-warming**

After writing metadata, fire-and-forget a cover art lookup (same pattern as `pipeline.js` line 287-290):

```javascript
// Step 8: Pre-warm cover art cache (fire-and-forget)
try {
  fetch(`http://localhost:${process.env.PORT || 3000}/api/cover/search?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}`, {
    signal: AbortSignal.timeout(10000),
  }).catch(() => {});
} catch {}
```

- [ ] **Step 3: Add `soulseek-download` to no-downgrade guard in job-worker.js**

In `packages/server/src/services/job-worker.js`, the worker checks existing library quality before processing a download job. Find the job type check (look for `job.type === 'download'`) and extend it to also cover `'soulseek-download'`:

```javascript
// Before (approximate):
if (job.type === 'download') {
  // ... no-downgrade check
}

// After:
if (job.type === 'download' || job.type === 'soulseek-download') {
  // ... no-downgrade check
}
```

- [ ] **Step 4: Write test for no-downgrade guard with soulseek-download**

Add to job-worker tests:

```javascript
test('skips soulseek-download when existing album is already flac', async () => {
  // Mock library check to return existing flac quality
  // Enqueue soulseek-download job
  // Verify job is skipped with reason 'skipped_no_upgrade'
});
```

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/job-processor.js packages/server/src/services/job-worker.js packages/server/__tests__/services/job-processor.test.js
git commit -m "feat(pipeline): add metadata, cover art, and no-downgrade guard for soulseek downloads"
```

---

### Task 8: ClamAV Docker configuration for dev

ClamAV is already integrated into `file-validator.js` (called as part of `validateFile()`), but the dev Docker Compose doesn't enable it. For Soulseek downloads this matters more than torrents — torrent files are at least partially vetted by Real-Debrid, but Soulseek files come directly from untrusted peers.

**Files:**
- Modify: `docker-compose.dev.yml`

- [ ] **Step 1: Enable ClamAV in dev compose**

The `clamav` service is defined in `docker-compose.yml` (base) under the `security` profile. Enable it in dev by adding to `docker-compose.dev.yml`:

```yaml
  clamav:
    profiles: []  # override the security profile to always-on in dev

  not-ify:
    environment:
      # ... existing env vars ...
      - CLAM_ENABLED=true
      - CLAM_HOST=clamav
      - CLAM_PORT=3310
    depends_on:
      # ... existing deps ...
      clamav:
        condition: service_healthy
```

Note: ClamAV takes 2-3 minutes to start (downloading virus definitions). The healthcheck `start_period: 120s` in the base compose handles this.

- [ ] **Step 2: Verify ClamAV works in Docker**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d clamav
# Wait for healthy...
docker exec notify-clamav-1 clamdscan --ping 1
```

- [ ] **Step 3: Commit**

```bash
git add docker-compose.dev.yml
git commit -m "feat(docker): enable ClamAV in dev for Soulseek file scanning"
```

---

### Task 9: End-to-end manual verification

- [ ] **Step 1: Rebuild and restart Docker containers**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d
```

- [ ] **Step 2: Verify slskd is connected**

```bash
curl -s http://localhost:5030/api/v0/server | jq .isConnected
```

- [ ] **Step 3: Test the cascade search returns Soulseek results**

```bash
SLSKD_URL=http://localhost:5030 node -e "
const { searchForUpgrade } = require('./packages/server/src/services/search');
searchForUpgrade({ artist: 'Daft Punk', album: 'Discovery' }).then(r => console.log(JSON.stringify(r, null, 2)));
"
```

- [ ] **Step 4: Verify volume sharing works end-to-end**

Manually trigger a small Soulseek download via the slskd UI, then verify the file appears in the not-ify container at `/app/slskd-downloads/`.

- [ ] **Step 5: Commit any fixes**

---

## Integration Checklist

Every step the torrent download path performs, Soulseek must also perform:

| Step | Torrent Path | Soulseek Path | Task |
|------|-------------|---------------|------|
| Entry: upgrade job | `searchForUpgrade()` | `searchForUpgrade()` + cascade | Task 3 |
| Entry: manual download | `POST /api/download` | **Not in scope** (queue-only for v1) | — |
| No-downgrade guard | `job-worker.js` checks | Extended to `soulseek-download` | Task 7 |
| File download | RD → download | slskd enqueue → poll → copy | Task 4 |
| Size/MIME/ffprobe | `fileValidator.validateFile()` | Same call | Task 4 |
| ClamAV scan | Part of `validateFile()` | Same call, ClamAV enabled in dev | Task 8 |
| MB track matching | `downloadValidator.validate()` | Same call | Task 4 |
| Library move | `fs.renameSync` to `MUSIC_DIR` | Same pattern | Task 4 |
| `.metadata.json` | Written in pipeline.js | Written in processSoulseekDownload | Task 7 |
| Cover art pre-warm | `fetch /api/cover/search` | Same pattern | Task 7 |
| Activity logging | `activityLog.log()` | Same calls throughout | Task 4 |
| Staging cleanup | `fs.rmSync(stagingDir)` | Same in `finally` | Task 4 |
| Source cleanup | `rd.deleteTorrent()` | `fs.rmSync(slskdUserDir)` | Task 6 |

**Not in v1 scope:**
- Foreground SSE streaming for Soulseek downloads (UI would need progress events — complex, save for later)
- `POST /api/download/background` Soulseek variant (use job queue instead)

## Notes

- **No RD involvement:** Soulseek downloads go directly from peer to slskd to library. Real-Debrid is only used for the torrent path.
- **Rate limiting:** The cascade search includes 1.5s cooldown between strategies. The download polling uses 5s intervals. Neither should stress slskd.
- **Fallback ordering:** Torrents are searched first (faster, more reliable), Soulseek is a supplementary source. The scoring system naturally ranks high-seeder torrents above single Soulseek users.
- **Soulseek download speed:** Depends on the peer. Free slots + high speed users are preferred by `pickBestSoulseekUser`. Timeout is 30 minutes (configurable via `SLSK_DOWNLOAD_TIMEOUT`).
- **File organization:** slskd stores downloads as `/downloads/{username}/{remote_path}/`. The processor walks this directory tree for audio files.
- **Security:** All Soulseek filenames are sanitized with `path.basename()` + `sanitizePath()` before writing to disk. ClamAV scans every file before library import.
