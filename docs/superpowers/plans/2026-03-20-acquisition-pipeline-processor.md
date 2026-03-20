# Acquisition Pipeline Processor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the stub job processor into a fully functional background pipeline: LLM-enhanced search → RD download → validation → library replacement.

**Architecture:** Two new modules (job-processor.js, download-validator.js) connect existing services. search.js gets LLM query expansion. downloader.js gets discography-aware file selection. The stub processor in index.js is replaced with a real one.

**Tech Stack:** Node.js, Express, SQLite (better-sqlite3), Ollama/Qwen3:4b, MusicBrainz API, Real-Debrid API, ffprobe

**Spec:** `docs/superpowers/specs/2026-03-20-acquisition-pipeline-processor-design.md`

---

### Task 1: Download Validator — tests

**Files:**
- Create: `packages/server/__tests__/services/download-validator.test.js`

- [ ] **Step 1: Write tests for duration scoring**

```javascript
'use strict';

// download-validator uses ffprobe and MusicBrainz — mock both
const childProcess = require('child_process');
jest.mock('child_process');

const mockGetReleaseTracks = jest.fn();
const mockSearchReleases = jest.fn();
jest.mock('../../src/services/musicbrainz', () => ({
  getReleaseTracks: (...args) => mockGetReleaseTracks(...args),
  searchReleases: (...args) => mockSearchReleases(...args),
}));

const { validate, computeScore } = require('../../src/services/download-validator');

// Helper: mock ffprobe to return specific durations for files
function mockFfprobe(durations) {
  // Each call to execSync with ffprobe returns JSON with format.duration
  let callIdx = 0;
  childProcess.execSync.mockImplementation((cmd) => {
    if (cmd.includes('ffprobe')) {
      const dur = durations[callIdx++] || 0;
      return JSON.stringify({ format: { duration: String(dur) } });
    }
    return '';
  });
}

describe('download-validator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('computeScore', () => {
    test('perfect match returns score near 0', () => {
      const expected = [
        { position: 1, title: 'Track 1', lengthMs: 240000 },
        { position: 2, title: 'Track 2', lengthMs: 300000 },
        { position: 3, title: 'Track 3', lengthMs: 180000 },
      ];
      const actual = [240, 300, 180]; // durations in seconds
      const result = computeScore(expected, actual);
      expect(result.score).toBeLessThan(0.05);
      expect(result.confidence).toBe('high');
      expect(result.trackCount.expected).toBe(3);
      expect(result.trackCount.actual).toBe(3);
    });

    test('duration deltas within 10s grace score 0', () => {
      const expected = [
        { position: 1, title: 'T1', lengthMs: 240000 },
        { position: 2, title: 'T2', lengthMs: 300000 },
      ];
      const actual = [245, 295]; // within 10s
      const result = computeScore(expected, actual);
      expect(result.score).toBeLessThan(0.05);
      expect(result.confidence).toBe('high');
    });

    test('duration deltas 20s average scores medium', () => {
      const expected = [
        { position: 1, title: 'T1', lengthMs: 240000 },
        { position: 2, title: 'T2', lengthMs: 300000 },
      ];
      const actual = [260, 320]; // 20s off each
      const result = computeScore(expected, actual);
      expect(result.score).toBeGreaterThan(0.15);
      expect(result.score).toBeLessThan(0.40);
      expect(result.confidence).toBe('medium');
    });

    test('wrong album (very different durations) scores low confidence', () => {
      const expected = [
        { position: 1, title: 'T1', lengthMs: 240000 },
        { position: 2, title: 'T2', lengthMs: 300000 },
        { position: 3, title: 'T3', lengthMs: 180000 },
      ];
      const actual = [60, 90, 45]; // completely different
      const result = computeScore(expected, actual);
      expect(result.score).toBeGreaterThanOrEqual(0.40);
      expect(result.confidence).toBe('low');
    });

    test('track count off by 1 adds moderate penalty', () => {
      const expected = [
        { position: 1, title: 'T1', lengthMs: 240000 },
        { position: 2, title: 'T2', lengthMs: 300000 },
      ];
      const actual = [240, 300, 200]; // 3 files, expected 2 (bonus track)
      const result = computeScore(expected, actual);
      // Track count penalty is 0.3 * 0.5 = 0.15, but durations match well
      expect(result.score).toBeLessThan(0.25);
    });

    test('track count off by 2+ adds full penalty', () => {
      const expected = [
        { position: 1, title: 'T1', lengthMs: 240000 },
      ];
      const actual = [240, 300, 200, 180, 250]; // 5 files, expected 1
      const result = computeScore(expected, actual);
      expect(result.score).toBeGreaterThan(0.25);
    });

    test('greedy pairing handles out-of-order tracks', () => {
      const expected = [
        { position: 1, title: 'T1', lengthMs: 120000 },
        { position: 2, title: 'T2', lengthMs: 300000 },
        { position: 3, title: 'T3', lengthMs: 240000 },
      ];
      // Files are in different order but same durations
      const actual = [300, 240, 120];
      const result = computeScore(expected, actual);
      expect(result.score).toBeLessThan(0.05);
      expect(result.confidence).toBe('high');
    });
  });

  describe('validate', () => {
    test('returns high confidence when MB tracks match', async () => {
      mockGetReleaseTracks.mockResolvedValue([
        { position: 1, title: 'Track 1', lengthMs: 240000 },
        { position: 2, title: 'Track 2', lengthMs: 300000 },
      ]);
      mockFfprobe([240, 300]);

      const result = await validate({
        files: ['/staging/01.flac', '/staging/02.flac'],
        mbid: 'test-mbid',
      });

      expect(result.confidence).toBe('high');
      expect(mockGetReleaseTracks).toHaveBeenCalledWith('test-mbid');
    });

    test('falls back to searchReleases when no mbid', async () => {
      mockSearchReleases.mockResolvedValue([{ mbid: 'found-mbid', artist: 'A', album: 'B' }]);
      mockGetReleaseTracks.mockResolvedValue([
        { position: 1, title: 'T1', lengthMs: 200000 },
      ]);
      mockFfprobe([200]);

      const result = await validate({
        files: ['/staging/01.flac'],
        artist: 'A',
        album: 'B',
      });

      expect(result.confidence).toBe('high');
      expect(mockSearchReleases).toHaveBeenCalled();
    });

    test('returns fallback result when MB unavailable', async () => {
      mockGetReleaseTracks.mockRejectedValue(new Error('MB down'));
      mockSearchReleases.mockRejectedValue(new Error('MB down'));
      mockFfprobe([240, 300, 180, 200, 250, 220, 280, 190]);

      const result = await validate({
        files: Array(8).fill('/staging/track.flac'),
        mbid: 'bad-mbid',
        existingTrackCount: 9,
      });

      // 8 files vs 9 existing = within ±2 tolerance
      expect(result.confidence).not.toBe('low');
      expect(result.details).toContain('fallback');
    });

    test('fallback rejects when track count too different', async () => {
      mockGetReleaseTracks.mockRejectedValue(new Error('MB down'));
      mockSearchReleases.mockRejectedValue(new Error('MB down'));
      mockFfprobe([240, 300]);

      const result = await validate({
        files: ['/staging/01.flac', '/staging/02.flac'],
        mbid: 'bad-mbid',
        existingTrackCount: 12,
      });

      expect(result.confidence).toBe('low');
    });

    test('fallback for new album checks duration range', async () => {
      mockGetReleaseTracks.mockRejectedValue(new Error('MB down'));
      mockSearchReleases.mockRejectedValue(new Error('MB down'));
      // 5 files, each 4min = 20min total — valid album range
      mockFfprobe([240, 240, 240, 240, 240]);

      const result = await validate({
        files: Array(5).fill('/staging/track.flac'),
        artist: 'A',
        album: 'B',
      });

      expect(result.confidence).not.toBe('low');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && npx jest __tests__/services/download-validator.test.js --no-cache 2>&1 | head -20`
Expected: FAIL — Cannot find module `../../src/services/download-validator`

- [ ] **Step 3: Commit test file**

```bash
git add packages/server/__tests__/services/download-validator.test.js
git commit -m "test(download-validator): add validation scoring tests"
```

---

### Task 2: Download Validator — implementation

**Files:**
- Create: `packages/server/src/services/download-validator.js`

- [ ] **Step 1: Implement download-validator.js**

```javascript
'use strict';

const childProcess = require('child_process');
const mb = require('./musicbrainz');

/**
 * Read duration (seconds) from an audio file using ffprobe.
 * Returns 0 on failure.
 */
function getFileDuration(filePath) {
  try {
    const raw = childProcess.execSync(
      `ffprobe -v error -show_format -of json "${filePath}"`
    ).toString();
    const parsed = JSON.parse(raw);
    return parseFloat(parsed.format?.duration) || 0;
  } catch {
    return 0;
  }
}

/**
 * Greedy closest-match pairing.
 * For each expected track, find the closest unmatched actual duration.
 * Returns array of { expected, actual, delta } pairs.
 */
function pairTracks(expectedTracks, actualDurations) {
  const expectedSecs = expectedTracks.map(t => (t.lengthMs || 0) / 1000);
  const available = actualDurations.map((d, i) => ({ duration: d, idx: i, used: false }));
  const pairs = [];

  for (const exp of expectedSecs) {
    let bestIdx = -1;
    let bestDelta = Infinity;
    for (let i = 0; i < available.length; i++) {
      if (available[i].used) continue;
      const delta = Math.abs(available[i].duration - exp);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      available[bestIdx].used = true;
      pairs.push({ expected: exp, actual: available[bestIdx].duration, delta: bestDelta });
    } else {
      pairs.push({ expected: exp, actual: 0, delta: exp });
    }
  }
  return pairs;
}

/**
 * Compute match score between expected MB tracks and actual file durations.
 * Score: 0.0 = perfect match, 1.0 = no match.
 *
 * @param {Array<{position, title, lengthMs}>} expectedTracks - from MusicBrainz
 * @param {number[]} actualDurations - file durations in seconds
 * @returns {{ score, confidence, trackCount, durationDelta, details }}
 */
function computeScore(expectedTracks, actualDurations) {
  const expectedCount = expectedTracks.length;
  const actualCount = actualDurations.length;

  // Track count score (weight 0.3)
  let trackCountScore;
  const countDiff = Math.abs(expectedCount - actualCount);
  if (countDiff === 0) trackCountScore = 0;
  else if (countDiff === 1) trackCountScore = 0.5;
  else trackCountScore = 1.0;

  // Duration match score (weight 0.5) — greedy closest-match pairing
  const pairs = pairTracks(expectedTracks, actualDurations);
  let durationScoreSum = 0;
  for (const pair of pairs) {
    const delta = pair.delta;
    if (delta <= 10) durationScoreSum += 0;
    else if (delta <= 30) durationScoreSum += (delta - 10) / 20;
    else durationScoreSum += 1.0;
  }
  const durationScore = pairs.length > 0 ? durationScoreSum / pairs.length : 1.0;

  // Total duration score (weight 0.2)
  const expectedTotal = expectedTracks.reduce((s, t) => s + (t.lengthMs || 0) / 1000, 0);
  const actualTotal = actualDurations.reduce((s, d) => s + d, 0);
  const totalDelta = Math.abs(expectedTotal - actualTotal);
  let totalDurationScore;
  if (totalDelta <= 30) totalDurationScore = 0;
  else if (totalDelta <= 120) totalDurationScore = (totalDelta - 30) / 90;
  else totalDurationScore = 1.0;

  const score = 0.3 * trackCountScore + 0.5 * durationScore + 0.2 * totalDurationScore;
  const avgPerTrackDelta = pairs.length > 0 ? pairs.reduce((s, p) => s + p.delta, 0) / pairs.length : 0;

  let confidence;
  if (score < 0.15) confidence = 'high';
  else if (score < 0.40) confidence = 'medium';
  else confidence = 'low';

  return {
    score: +score.toFixed(3),
    confidence,
    trackCount: { expected: expectedCount, actual: actualCount },
    durationDelta: { avgPerTrack: +avgPerTrackDelta.toFixed(1), total: +totalDelta.toFixed(1) },
    details: `${actualCount}/${expectedCount} tracks, avg delta ${avgPerTrackDelta.toFixed(1)}s`,
  };
}

/**
 * Validate downloaded files against MusicBrainz release data.
 *
 * @param {object} opts
 * @param {string[]} opts.files - paths to downloaded audio files
 * @param {string} [opts.mbid] - MusicBrainz release ID
 * @param {string} [opts.rgid] - MusicBrainz release-group ID
 * @param {string} [opts.artist] - for search fallback
 * @param {string} [opts.album] - for search fallback
 * @param {number} [opts.existingTrackCount] - library track count for fallback
 * @returns {Promise<{ score, confidence, trackCount, durationDelta, details }>}
 */
async function validate({ files, mbid, rgid, artist, album, existingTrackCount }) {
  const actualDurations = files.map(f => getFileDuration(f));

  // Try to get MB track data
  let mbTracks = null;
  try {
    if (mbid) {
      mbTracks = await mb.getReleaseTracks(mbid);
    } else if (rgid) {
      // Release-group ID: search for releases in this group, pick best
      const releases = await mb.searchReleases(`rgid:${rgid}`);
      if (releases.length > 0) {
        mbTracks = await mb.getReleaseTracks(releases[0].mbid);
      }
    }
    if (!mbTracks && artist && album) {
      const releases = await mb.searchReleases(`${artist} ${album}`);
      if (releases.length > 0) {
        mbTracks = await mb.getReleaseTracks(releases[0].mbid);
      }
    }
  } catch {
    mbTracks = null;
  }

  if (mbTracks && mbTracks.length > 0) {
    return computeScore(mbTracks, actualDurations);
  }

  // Fallback: no MB data available
  const totalDuration = actualDurations.reduce((s, d) => s + d, 0);
  const totalMinutes = totalDuration / 60;

  if (existingTrackCount != null) {
    // Compare against existing library
    const countDiff = Math.abs(files.length - existingTrackCount);
    if (countDiff <= 2) {
      return {
        score: 0.20,
        confidence: 'medium',
        trackCount: { expected: existingTrackCount, actual: files.length },
        durationDelta: { avgPerTrack: 0, total: 0 },
        details: `fallback: ${files.length} files vs ${existingTrackCount} existing (±${countDiff})`,
      };
    }
    return {
      score: 0.60,
      confidence: 'low',
      trackCount: { expected: existingTrackCount, actual: files.length },
      durationDelta: { avgPerTrack: 0, total: 0 },
      details: `fallback: ${files.length} files vs ${existingTrackCount} existing — count mismatch`,
    };
  }

  // New album, no existing — check file count + duration range
  if (files.length >= 4 && totalMinutes >= 15 && totalMinutes <= 150) {
    return {
      score: 0.25,
      confidence: 'medium',
      trackCount: { expected: 0, actual: files.length },
      durationDelta: { avgPerTrack: 0, total: 0 },
      details: `fallback: new album, ${files.length} files, ${totalMinutes.toFixed(0)}min total`,
    };
  }

  return {
    score: 0.60,
    confidence: 'low',
    trackCount: { expected: 0, actual: files.length },
    durationDelta: { avgPerTrack: 0, total: 0 },
    details: `fallback: rejected — ${files.length} files, ${totalMinutes.toFixed(0)}min total (outside 15-150min range)`,
  };
}

module.exports = { validate, computeScore, _test: { getFileDuration, pairTracks } };
```

- [ ] **Step 2: Run tests**

Run: `cd packages/server && npx jest __tests__/services/download-validator.test.js --no-cache`
Expected: PASS (all tests)

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/services/download-validator.js
git commit -m "feat(pipeline): add download-validator with MB scoring"
```

---

### Task 3: Discography file selection — tests + implementation

**Files:**
- Create: `packages/server/__tests__/services/album-file-selector.test.js`
- Modify: `packages/server/src/services/downloader.js`

- [ ] **Step 1: Write tests**

```javascript
'use strict';

const { selectAlbumFiles } = require('../../src/services/downloader');

describe('selectAlbumFiles', () => {
  test('single album torrent selects all audio files', () => {
    const rdFiles = [
      { id: 1, path: 'Artist - Album/01 - Track.flac', bytes: 30000000 },
      { id: 2, path: 'Artist - Album/02 - Track.flac', bytes: 30000000 },
      { id: 3, path: 'Artist - Album/cover.jpg', bytes: 500000 },
    ];
    const result = selectAlbumFiles(rdFiles, 'Artist', 'Album');
    expect(result.fileIds).toEqual([1, 2]);
    expect(result.isDiscography).toBe(false);
  });

  test('discography torrent selects only matching album folder', () => {
    const rdFiles = [
      { id: 1, path: 'Artist Discography/2000 - First Album/01.flac', bytes: 30000000 },
      { id: 2, path: 'Artist Discography/2000 - First Album/02.flac', bytes: 30000000 },
      { id: 3, path: 'Artist Discography/2004 - Target Album/01.flac', bytes: 30000000 },
      { id: 4, path: 'Artist Discography/2004 - Target Album/02.flac', bytes: 30000000 },
      { id: 5, path: 'Artist Discography/2008 - Third Album/01.flac', bytes: 30000000 },
    ];
    const result = selectAlbumFiles(rdFiles, 'Artist', 'Target Album');
    expect(result.fileIds).toEqual([3, 4]);
    expect(result.isDiscography).toBe(true);
  });

  test('strips year and brackets from folder names when matching', () => {
    const rdFiles = [
      { id: 1, path: 'Complete/OK Computer [1997] [FLAC]/01.flac', bytes: 30000000 },
      { id: 2, path: 'Complete/OK Computer [1997] [FLAC]/02.flac', bytes: 30000000 },
      { id: 3, path: 'Complete/The Bends [1995] [FLAC]/01.flac', bytes: 30000000 },
    ];
    const result = selectAlbumFiles(rdFiles, 'Radiohead', 'OK Computer');
    expect(result.fileIds).toEqual([1, 2]);
  });

  test('flat folder with all audio returns all files', () => {
    const rdFiles = [
      { id: 1, path: '01 - Track.flac', bytes: 30000000 },
      { id: 2, path: '02 - Track.flac', bytes: 30000000 },
      { id: 3, path: 'cover.jpg', bytes: 500000 },
    ];
    const result = selectAlbumFiles(rdFiles, 'Artist', 'Album');
    expect(result.fileIds).toEqual([1, 2]);
    expect(result.isDiscography).toBe(false);
  });

  test('multiple folders with no match returns empty', () => {
    const rdFiles = [
      { id: 1, path: 'Other Artist/Album A/01.flac', bytes: 30000000 },
      { id: 2, path: 'Other Artist/Album B/01.flac', bytes: 30000000 },
    ];
    const result = selectAlbumFiles(rdFiles, 'Target Artist', 'Target Album');
    expect(result.fileIds).toEqual([]);
    expect(result.noMatch).toBe(true);
  });

  test('filters non-audio extensions', () => {
    const rdFiles = [
      { id: 1, path: 'Album/01.flac', bytes: 30000000 },
      { id: 2, path: 'Album/info.nfo', bytes: 1000 },
      { id: 3, path: 'Album/cover.jpg', bytes: 500000 },
      { id: 4, path: 'Album/album.cue', bytes: 2000 },
    ];
    const result = selectAlbumFiles(rdFiles, 'Artist', 'Album');
    expect(result.fileIds).toEqual([1]);
  });

  test('case-insensitive matching', () => {
    const rdFiles = [
      { id: 1, path: 'ARTIST DISCOGRAPHY/target album/01.FLAC', bytes: 30000000 },
      { id: 2, path: 'ARTIST DISCOGRAPHY/other album/01.FLAC', bytes: 30000000 },
    ];
    const result = selectAlbumFiles(rdFiles, 'Artist', 'Target Album');
    expect(result.fileIds).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && npx jest __tests__/services/album-file-selector.test.js --no-cache 2>&1 | head -5`
Expected: FAIL — `selectAlbumFiles` is not exported

- [ ] **Step 3: Implement selectAlbumFiles in downloader.js**

Add before `module.exports` in `packages/server/src/services/downloader.js`:

```javascript
/**
 * Select audio files from an RD file list, optionally filtering to a target album
 * folder when the torrent contains a discography.
 *
 * @param {Array<{id, path, bytes}>} rdFiles - files from rd.getTorrentInfo().files
 * @param {string} targetArtist - expected artist
 * @param {string} targetAlbum - expected album
 * @returns {{ fileIds: number[], isDiscography: boolean, noMatch?: boolean }}
 */
function selectAlbumFiles(rdFiles, targetArtist, targetAlbum) {
  const audioFiles = rdFiles.filter(f => isAudioFile(f.path));

  // Group audio files by parent directory
  const dirMap = new Map(); // dir -> [file]
  for (const f of audioFiles) {
    const parts = f.path.replace(/\\/g, '/').split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    if (!dirMap.has(dir)) dirMap.set(dir, []);
    dirMap.get(dir).push(f);
  }

  const dirs = [...dirMap.keys()];

  // Single directory or flat files — not a discography
  if (dirs.length <= 1) {
    return { fileIds: audioFiles.map(f => f.id), isDiscography: false };
  }

  // Multiple directories — find the one matching target album
  const normalizeDir = (d) => {
    const leaf = d.split('/').pop() || d;
    return leaf
      .replace(/\[\d{4}\]/g, '')         // [1997]
      .replace(/\(\d{4}\)/g, '')         // (1997)
      .replace(/^\d{4}\s*[-–—]\s*/g, '') // 2004 -
      .replace(/\[.*?\]/g, '')           // [FLAC], [WEB], etc.
      .replace(/\(.*?\)/g, '')           // (Deluxe), etc.
      .replace(/[_\-–—]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  };

  const targetTokens = targetAlbum.toLowerCase().split(/\s+/).filter(t => t.length > 1);

  for (const [dir, files] of dirMap) {
    const normalized = normalizeDir(dir);
    const allTokensMatch = targetTokens.every(t => normalized.includes(t));
    if (allTokensMatch) {
      return { fileIds: files.map(f => f.id), isDiscography: true };
    }
  }

  // No match found
  return { fileIds: [], isDiscography: true, noMatch: true };
}
```

Add `selectAlbumFiles` to the `module.exports` object.

- [ ] **Step 4: Run tests**

Run: `cd packages/server && npx jest __tests__/services/album-file-selector.test.js --no-cache`
Expected: PASS

- [ ] **Step 5: Run existing downloader tests to check no regression**

Run: `cd packages/server && npx jest __tests__/services/download-timeout.test.js --no-cache`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/downloader.js packages/server/__tests__/services/album-file-selector.test.js
git commit -m "feat(pipeline): add selectAlbumFiles for discography extraction"
```

---

### Task 4: LLM search query expansion — tests + implementation

**Files:**
- Create: `packages/server/__tests__/services/search-upgrade.test.js`
- Modify: `packages/server/src/services/search.js`

- [ ] **Step 1: Write tests**

```javascript
'use strict';

const mockPrompt = jest.fn();
const mockParseTorrentBatch = jest.fn();
const mockCheckHealth = jest.fn();
jest.mock('../../src/services/llm', () => ({
  prompt: (...args) => mockPrompt(...args),
  parseTorrentBatch: (...args) => mockParseTorrentBatch(...args),
  checkHealth: (...args) => mockCheckHealth(...args),
}));

const mockSearchMusic = jest.fn();
jest.mock('../../src/services/search', () => {
  const original = jest.requireActual('../../src/services/search');
  return {
    ...original,
    searchMusic: (...args) => mockSearchMusic(...args),
  };
});

// Import after mocks
let searchForUpgrade, generateSearchQueries;
beforeAll(() => {
  const mod = require('../../src/services/search');
  searchForUpgrade = mod.searchForUpgrade;
  generateSearchQueries = mod.generateSearchQueries;
});

describe('generateSearchQueries', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns LLM-generated queries when available', async () => {
    mockCheckHealth.mockResolvedValue(true);
    mockPrompt.mockResolvedValue({
      queries: [
        'boards of canada music has the right to children flac',
        'boards of canada discography flac',
        'BoC music right children lossless',
      ],
    });

    const queries = await generateSearchQueries('Boards of Canada', 'Music Has the Right to Children', 'flac');
    expect(queries.length).toBeGreaterThanOrEqual(3);
    expect(mockPrompt).toHaveBeenCalled();
  });

  test('falls back to programmatic queries when LLM unavailable', async () => {
    mockCheckHealth.mockResolvedValue(false);

    const queries = await generateSearchQueries('Radiohead', 'OK Computer', 'flac');
    expect(queries).toContain('Radiohead OK Computer flac');
    expect(queries.some(q => q.includes('discography'))).toBe(true);
    expect(mockPrompt).not.toHaveBeenCalled();
  });

  test('falls back when LLM returns invalid response', async () => {
    mockCheckHealth.mockResolvedValue(true);
    mockPrompt.mockResolvedValue(null);

    const queries = await generateSearchQueries('Artist', 'Album', 'flac');
    expect(queries.length).toBeGreaterThanOrEqual(2);
  });
});

describe('searchForUpgrade', () => {
  beforeEach(() => jest.clearAllMocks());

  test('deduplicates results across multiple queries', async () => {
    mockCheckHealth.mockResolvedValue(false); // skip LLM
    const torrent = { id: '1', name: 'Artist - Album FLAC', magnetLink: 'magnet:?xt=urn:btih:abc', seeders: 10, leechers: 2, size: '500000000', source: 'apibay' };
    mockSearchMusic.mockResolvedValue([torrent]);

    const result = await searchForUpgrade({ artist: 'Artist', album: 'Album', targetQuality: 'flac' });
    // Called with multiple queries but same result deduped
    expect(mockSearchMusic).toHaveBeenCalledTimes(2); // 2 fallback queries
    expect(result).not.toBeNull();
    expect(result.magnetLink).toBe('magnet:?xt=urn:btih:abc');
  });

  test('returns null when no results found', async () => {
    mockCheckHealth.mockResolvedValue(false);
    mockSearchMusic.mockResolvedValue([]);

    const result = await searchForUpgrade({ artist: 'Unknown', album: 'Nothing', targetQuality: 'flac' });
    expect(result).toBeNull();
  });

  test('ranks results by token match + quality + seeders', async () => {
    mockCheckHealth.mockResolvedValue(false);
    const torrents = [
      { id: '1', name: 'Artist Discography MP3', magnetLink: 'magnet:1', seeders: 100, leechers: 5, size: '1000000000', source: 'apibay' },
      { id: '2', name: 'Artist - Album [FLAC]', magnetLink: 'magnet:2', seeders: 20, leechers: 2, size: '500000000', source: 'apibay' },
    ];
    mockSearchMusic.mockResolvedValue(torrents);

    const result = await searchForUpgrade({ artist: 'Artist', album: 'Album', targetQuality: 'flac' });
    // FLAC album match should beat MP3 discography despite fewer seeders
    expect(result.magnetLink).toBe('magnet:2');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && npx jest __tests__/services/search-upgrade.test.js --no-cache 2>&1 | head -10`
Expected: FAIL — `searchForUpgrade` / `generateSearchQueries` not exported

- [ ] **Step 3: Implement in search.js**

Add to `packages/server/src/services/search.js`, before `module.exports`:

```javascript
const llm = require('./llm');

const SEARCH_QUERY_SCHEMA = {
  type: 'object',
  properties: {
    queries: { type: 'array', items: { type: 'string' } },
  },
  required: ['queries'],
};

/**
 * Generate multiple search queries for a target album using LLM.
 * Falls back to programmatic queries when LLM unavailable.
 */
async function generateSearchQueries(artist, album, targetQuality = 'flac') {
  const fallback = [
    `${artist} ${album} ${targetQuality}`,
    `${artist} discography ${targetQuality}`,
  ];

  try {
    const healthy = await llm.checkHealth();
    if (!healthy) return fallback;

    const result = await llm.prompt(
      `Generate 3-5 torrent search queries to find this music album in ${targetQuality} quality.\n` +
      `Artist: ${artist}\nAlbum: ${album}\n\n` +
      `Rules:\n` +
      `- Include the standard query: "artist album ${targetQuality}"\n` +
      `- Include a discography query: "artist discography ${targetQuality}" or "artist complete lossless"\n` +
      `- Include abbreviated or alternate name forms if the artist/album has common shortenings\n` +
      `- Include a year-tagged variant if you know the release year\n` +
      `- Each query should be a plain search string, no operators\n` +
      `- Return ONLY the queries array, no explanations`,
      SEARCH_QUERY_SCHEMA
    );

    if (result?.queries?.length > 0) {
      // Ensure fallback queries are always included
      const set = new Set(result.queries.map(q => q.toLowerCase().trim()));
      for (const f of fallback) {
        if (!set.has(f.toLowerCase())) result.queries.push(f);
      }
      return result.queries;
    }
  } catch {
    // LLM failed, use fallback
  }

  return fallback;
}

// Quality tokens to detect in torrent names
const QUALITY_TOKENS = {
  flac: 5, lossless: 5, '24bit': 5, '24-bit': 5,
  '320': 3, '320kbps': 3, v0: 3, mp3: 1,
};

/**
 * Score a torrent result against the target artist/album/quality.
 * Returns 0.0 (no match) to 1.0 (perfect match).
 */
function scoreResult(torrentName, artist, album, targetQuality, seeders, maxSeeders) {
  const lower = torrentName.toLowerCase();
  const artistTokens = artist.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  const albumTokens = album.toLowerCase().split(/\s+/).filter(t => t.length > 1);

  // Artist match (0.35)
  const artistHits = artistTokens.filter(t => lower.includes(t)).length;
  const artistScore = artistTokens.length > 0 ? artistHits / artistTokens.length : 0;

  // Album match (0.35) — discography counts as partial match
  const isDiscography = /discograph|complete|anthology|collection/i.test(lower);
  let albumScore;
  if (isDiscography) {
    albumScore = 0.5; // partial credit for discographies
  } else {
    const albumHits = albumTokens.filter(t => lower.includes(t)).length;
    albumScore = albumTokens.length > 0 ? albumHits / albumTokens.length : 0;
  }

  // Quality match (0.15)
  let qualityScore = 0;
  const targetRank = QUALITY_TOKENS[targetQuality.toLowerCase()] || 3;
  for (const [token, rank] of Object.entries(QUALITY_TOKENS)) {
    if (lower.includes(token) && rank >= targetRank) {
      qualityScore = 1.0;
      break;
    }
  }

  // Seeders (0.15)
  const clampedSeeders = Math.max(seeders, 1);
  const clampedMax = Math.max(maxSeeders, 2);
  const seederScore = Math.log2(clampedSeeders) / Math.log2(clampedMax);

  const total = 0.35 * artistScore + 0.35 * albumScore + 0.15 * qualityScore + 0.15 * Math.min(seederScore, 1);
  return { total, artistScore, albumScore, qualityScore, seederScore: Math.min(seederScore, 1), isDiscography };
}

/**
 * Search for a better quality source for an album.
 * Uses LLM query expansion when available, falls back to programmatic queries.
 *
 * @param {{ artist, album, targetQuality?, currentQuality? }} opts
 * @returns {Promise<{ magnetLink, name, seeders, score, isDiscography } | null>}
 */
async function searchForUpgrade({ artist, album, targetQuality = 'flac', currentQuality }) {
  const queries = await generateSearchQueries(artist, album, targetQuality);

  // Run all queries, collect unique results by magnet info_hash
  const seen = new Set();
  const allResults = [];

  for (const query of queries) {
    try {
      const results = await searchMusic(query);
      for (const r of results) {
        const hash = r.magnetLink?.match(/btih:([a-f0-9]+)/i)?.[1]?.toLowerCase();
        if (hash && !seen.has(hash)) {
          seen.add(hash);
          allResults.push(r);
        }
      }
    } catch {
      // Query failed, continue with others
    }
  }

  if (allResults.length === 0) return null;

  // Score and rank
  const maxSeeders = Math.max(...allResults.map(r => r.seeders || 0), 1);
  const scored = allResults.map(r => {
    const s = scoreResult(r.name, artist, album, targetQuality, r.seeders || 0, maxSeeders);
    return { ...r, score: s.total, isDiscography: s.isDiscography, scoring: s };
  });

  // Filter below threshold, sort descending
  const viable = scored.filter(r => r.score >= 0.3).sort((a, b) => b.score - a.score);
  if (viable.length === 0) return null;

  const best = viable[0];
  return {
    magnetLink: best.magnetLink,
    name: best.name,
    seeders: best.seeders,
    score: best.score,
    isDiscography: best.isDiscography,
    sources: [{ name: best.name, seeders: best.seeders, source: best.source }],
  };
}
```

Add `generateSearchQueries`, `searchForUpgrade`, and `scoreResult` to `module.exports`.

> **Spec deviation (intentional):** The spec calls for `llm.parseTorrentBatch()` in result ranking. This implementation uses regex/token-based `scoreResult()` instead — faster, no LLM dependency per search. The LLM training circuit (Task 10) will validate whether LLM-assisted ranking is worth adding. If the regex approach meets accuracy targets, `parseTorrentBatch` ranking is unnecessary complexity.

- [ ] **Step 4: Run tests**

Run: `cd packages/server && npx jest __tests__/services/search-upgrade.test.js --no-cache`
Expected: PASS

- [ ] **Step 5: Run existing search tests**

Run: `cd packages/server && npx jest __tests__/api/search.test.js --no-cache`
Expected: PASS (no regression)

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/search.js packages/server/__tests__/services/search-upgrade.test.js
git commit -m "feat(pipeline): add LLM search query expansion and result ranking"
```

---

### Task 5: Job Processor — tests

**Files:**
- Create: `packages/server/__tests__/services/job-processor.test.js`

- [ ] **Step 1: Write tests**

```javascript
'use strict';

// Mock all external dependencies
const mockAddMagnet = jest.fn();
const mockSelectFiles = jest.fn();
const mockGetTorrentInfo = jest.fn();
const mockUnrestrictLink = jest.fn();
const mockDeleteTorrent = jest.fn();
jest.mock('../../src/services/realdebrid', () => ({
  addMagnet: (...a) => mockAddMagnet(...a),
  selectFiles: (...a) => mockSelectFiles(...a),
  getTorrentInfo: (...a) => mockGetTorrentInfo(...a),
  unrestrictLink: (...a) => mockUnrestrictLink(...a),
  deleteTorrent: (...a) => mockDeleteTorrent(...a),
}));

const mockDownloadFile = jest.fn();
const mockExtractArchive = jest.fn();
const mockSelectAlbumFiles = jest.fn();
jest.mock('../../src/services/downloader', () => ({
  downloadFile: (...a) => mockDownloadFile(...a),
  extractArchive: (...a) => mockExtractArchive(...a),
  selectAlbumFiles: (...a) => mockSelectAlbumFiles(...a),
  isAudioFile: (f) => /\.(flac|mp3|ogg|m4a|aac|wav|opus)$/i.test(f),
  isArchive: (f) => /\.(rar|zip)$/i.test(f),
  sanitizePath: (s) => s.replace(/[<>:"/\\|?*]/g, '_').trim(),
}));

const mockValidateFile = jest.fn();
jest.mock('../../src/services/file-validator', () => ({
  validateFile: (...a) => mockValidateFile(...a),
}));

const mockDownloadValidate = jest.fn();
jest.mock('../../src/services/download-validator', () => ({
  validate: (...a) => mockDownloadValidate(...a),
}));

const mockLog = jest.fn();
jest.mock('../../src/services/activity-log', () => ({
  log: (...a) => mockLog(...a),
}));

jest.mock('../../src/services/pipeline', () => ({
  activeDownload: null,
}));

const fs = require('fs');
jest.mock('fs');

const { process: processJob } = require('../../src/services/job-processor');

describe('job-processor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MUSIC_DIR = '/test/music';
    fs.mkdirSync.mockReturnValue(undefined);
    fs.renameSync.mockReturnValue(undefined);
    fs.rmSync.mockReturnValue(undefined);
    fs.existsSync.mockReturnValue(false);
    fs.readdirSync.mockReturnValue([]);
  });

  test('processes download job end-to-end', async () => {
    const job = {
      id: 1,
      type: 'download',
      payload: JSON.stringify({ magnetLink: 'magnet:?xt=urn:btih:abc', artist: 'Artist', album: 'Album' }),
    };

    mockAddMagnet.mockResolvedValue({ id: 'rd-123' });
    mockGetTorrentInfo
      .mockResolvedValueOnce({ status: 'waiting_files_selection', files: [{ id: 1, path: '01.flac', bytes: 30000000 }] })
      .mockResolvedValueOnce({ status: 'downloaded', links: ['https://rd.io/file1'] });
    mockSelectAlbumFiles.mockReturnValue({ fileIds: [1], isDiscography: false });
    mockSelectFiles.mockResolvedValue(undefined);
    mockUnrestrictLink.mockResolvedValue({ download: 'https://dl.rd.io/file1', filename: '01.flac' });
    mockDownloadFile.mockResolvedValue('/test/music/_staging/Artist/Album/01.flac');
    mockValidateFile.mockResolvedValue({ passed: true, checks: [] });
    mockDownloadValidate.mockResolvedValue({ score: 0.05, confidence: 'high', details: 'ok' });

    const result = await processJob(job);
    expect(result.success).toBe(true);
    expect(mockAddMagnet).toHaveBeenCalledWith('magnet:?xt=urn:btih:abc');
    expect(mockSelectFiles).toHaveBeenCalledWith('rd-123', '1');
    expect(mockDeleteTorrent).toHaveBeenCalledWith('rd-123');
  });

  test('fails job when download validation rejects', async () => {
    const job = {
      id: 2,
      type: 'download',
      payload: JSON.stringify({ magnetLink: 'magnet:?xt=urn:btih:xyz', artist: 'A', album: 'B' }),
    };

    mockAddMagnet.mockResolvedValue({ id: 'rd-456' });
    mockGetTorrentInfo
      .mockResolvedValueOnce({ status: 'waiting_files_selection', files: [{ id: 1, path: '01.flac', bytes: 30000000 }] })
      .mockResolvedValueOnce({ status: 'downloaded', links: ['https://rd.io/f1'] });
    mockSelectAlbumFiles.mockReturnValue({ fileIds: [1], isDiscography: false });
    mockSelectFiles.mockResolvedValue(undefined);
    mockUnrestrictLink.mockResolvedValue({ download: 'https://dl.rd.io/f1', filename: '01.flac' });
    mockDownloadFile.mockResolvedValue('/test/music/_staging/A/B/01.flac');
    mockValidateFile.mockResolvedValue({ passed: true, checks: [] });
    mockDownloadValidate.mockResolvedValue({ score: 0.60, confidence: 'low', details: 'wrong album' });

    await expect(processJob(job)).rejects.toThrow(/validation failed/i);
    // Staging should be cleaned up
    expect(fs.rmSync).toHaveBeenCalled();
  });

  test('skips unknown job types', async () => {
    const job = { id: 3, type: 'unknown', payload: '{}' };
    const result = await processJob(job);
    expect(result.skipped).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && npx jest __tests__/services/job-processor.test.js --no-cache 2>&1 | head -5`
Expected: FAIL — Cannot find module `../../src/services/job-processor`

- [ ] **Step 3: Commit test file**

```bash
git add packages/server/__tests__/services/job-processor.test.js
git commit -m "test(pipeline): add job-processor integration tests"
```

---

### Task 6: Job Processor — implementation

**Files:**
- Create: `packages/server/src/services/job-processor.js`

- [ ] **Step 1: Implement job-processor.js**

```javascript
'use strict';

const fs = require('fs');
const path = require('path');
const rd = require('./realdebrid');
const downloader = require('./downloader');
const fileValidator = require('./file-validator');
const downloadValidator = require('./download-validator');
const activityLog = require('./activity-log');

const MUSIC_DIR = process.env.MUSIC_DIR || '/app/music';
const STAGING_DIR = path.join(MUSIC_DIR, '_staging');
const RD_FILE_SELECTION_TIMEOUT = 2 * 60 * 1000;  // 2 minutes
const RD_DOWNLOAD_TIMEOUT = 5 * 60 * 1000;         // 5 minutes
const POLL_INTERVAL = 2000;                         // 2 seconds

function log(category, level, message) {
  activityLog.log(category, level, message);
}

/**
 * Poll RD until torrent reaches target status.
 * Returns the torrent info object.
 */
async function pollRd(torrentId, targetStatus, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await rd.getTorrentInfo(torrentId);
    if (info.status === targetStatus) return info;
    if (info.status === 'magnet_error' || info.status === 'error' || info.status === 'virus' || info.status === 'dead') {
      throw new Error(`RD torrent failed with status: ${info.status}`);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
  throw new Error(`RD timeout waiting for ${targetStatus} (${timeoutMs}ms)`);
}

/**
 * Process a download job: magnet → RD → download → validate → replace.
 */
async function processDownload(job, payload) {
  const { magnetLink, artist, album, mbid, rgid, isDiscography, upgradeFrom } = payload;
  const stagingDir = path.join(STAGING_DIR, downloader.sanitizePath(artist), downloader.sanitizePath(album));
  let torrentId = null;

  try {
    // Step 1: Check concurrency with manual pipeline downloads
    const pipeline = require('./pipeline');
    if (pipeline.activeDownload) {
      throw new Error('REQUEUE: manual download active');
    }

    // Step 2: Add magnet
    log('pipeline', 'info', `[job ${job.id}] Adding magnet for ${artist} - ${album}`);
    const magnet = await rd.addMagnet(magnetLink);
    torrentId = magnet.id;

    // Step 3: Wait for file selection, get file list
    log('pipeline', 'info', `[job ${job.id}] Waiting for RD file selection...`);
    const fileInfo = await pollRd(torrentId, 'waiting_files_selection', RD_FILE_SELECTION_TIMEOUT);

    // Step 4: Select files (discography-aware)
    const selection = downloader.selectAlbumFiles(fileInfo.files || [], artist, album);
    if (selection.noMatch) {
      throw new Error(`No matching album folder found in torrent for "${album}"`);
    }
    const fileIdStr = selection.fileIds.join(',');
    if (!fileIdStr) {
      throw new Error('No audio files found in torrent');
    }
    await rd.selectFiles(torrentId, fileIdStr);
    log('pipeline', 'info', `[job ${job.id}] Selected ${selection.fileIds.length} files${selection.isDiscography ? ' (from discography)' : ''}`);

    // Step 5: Wait for RD to cache
    log('pipeline', 'info', `[job ${job.id}] Waiting for RD download...`);
    const cached = await pollRd(torrentId, 'downloaded', RD_DOWNLOAD_TIMEOUT);

    // Step 6: Unrestrict + download to staging
    fs.mkdirSync(stagingDir, { recursive: true });
    const downloadedFiles = [];
    const links = cached.links || [];

    for (const link of links) {
      const unrestricted = await rd.unrestrictLink(link);
      if (!downloader.isAudioFile(unrestricted.filename) && !downloader.isArchive(unrestricted.filename)) {
        continue; // skip non-audio, non-archive
      }
      const destPath = path.join(stagingDir, downloader.sanitizePath(unrestricted.filename));
      log('pipeline', 'info', `[job ${job.id}] Downloading: ${unrestricted.filename}`);
      await downloader.downloadFile(unrestricted.download, destPath);

      // Step 7: Extract archives
      if (downloader.isArchive(unrestricted.filename)) {
        const extracted = await downloader.extractArchive(destPath, stagingDir);
        downloadedFiles.push(...extracted);
      } else {
        downloadedFiles.push(destPath);
      }
    }

    if (downloadedFiles.length === 0) {
      throw new Error('No audio files downloaded');
    }

    // Step 8: File validation (MIME + ffprobe + ClamAV)
    for (const filePath of downloadedFiles) {
      const validation = await fileValidator.validateFile(filePath);
      if (!validation.passed) {
        const failedChecks = validation.checks.filter(c => !c.passed && !c.skipped).map(c => c.name).join(', ');
        throw new Error(`File validation failed for ${path.basename(filePath)}: ${failedChecks}`);
      }
    }
    log('pipeline', 'info', `[job ${job.id}] All ${downloadedFiles.length} files passed validation`);

    // Step 9: Download validation (MusicBrainz track matching)
    const existingDir = path.join(MUSIC_DIR, downloader.sanitizePath(artist), downloader.sanitizePath(album));
    let existingTrackCount;
    try {
      if (fs.existsSync(existingDir)) {
        existingTrackCount = fs.readdirSync(existingDir).filter(f => downloader.isAudioFile(f)).length;
      }
    } catch { /* no existing files */ }

    const validation = await downloadValidator.validate({
      files: downloadedFiles,
      mbid,
      rgid,
      artist,
      album,
      existingTrackCount,
    });

    log('pipeline', 'info', `[job ${job.id}] Validation: ${validation.confidence} confidence (score ${validation.score}) — ${validation.details}`);

    // Step 10: Replace or reject
    if (validation.confidence === 'low') {
      throw new Error(`Download validation failed (score ${validation.score}): ${validation.details}`);
    }

    // Move files from staging to library
    const destDir = path.join(MUSIC_DIR, downloader.sanitizePath(artist), downloader.sanitizePath(album));
    fs.mkdirSync(destDir, { recursive: true });
    for (const filePath of downloadedFiles) {
      const destPath = path.join(destDir, path.basename(filePath));
      fs.renameSync(filePath, destPath);
    }

    log('pipeline', 'success', `[job ${job.id}] ${artist} - ${album}: ${downloadedFiles.length} files replaced (${validation.confidence} confidence, ${upgradeFrom ? upgradeFrom + ' → ' : ''}upgraded)`);

    return {
      success: true,
      artist,
      album,
      files: downloadedFiles.length,
      confidence: validation.confidence,
      score: validation.score,
    };
  } finally {
    // Step 11: Cleanup staging
    try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch {}
    // Step 12: Cleanup RD torrent
    if (torrentId) {
      try { rd.deleteTorrent(torrentId); } catch {}
    }
  }
}

/**
 * Main job processor — dispatches by job type.
 * Registered with job-worker via setProcessor().
 */
async function process(job) {
  const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;

  switch (job.type) {
    case 'download':
      return processDownload(job, payload);

    default:
      log('pipeline', 'warn', `[job ${job.id}] Unknown job type: ${job.type}`);
      return { skipped: true, reason: `unknown type: ${job.type}` };
  }
}

module.exports = { process };
```

- [ ] **Step 2: Run tests**

Run: `cd packages/server && npx jest __tests__/services/job-processor.test.js --no-cache`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/services/job-processor.js
git commit -m "feat(pipeline): add job-processor with download orchestration"
```

---

### Task 7: Wire processor into index.js + adjust job-worker timeout

**Files:**
- Modify: `packages/server/src/index.js:557-569`
- Modify: `packages/server/src/services/job-worker.js:10`
- Modify: `packages/server/src/services/quality-upgrader.js:130-138`

- [ ] **Step 1: Increase job timeout for download jobs**

In `packages/server/src/services/job-worker.js`, change line 10:

```javascript
// Before:
const JOB_TIMEOUT = 600000; // 10 minutes

// After:
const JOB_TIMEOUT = 1200000; // 20 minutes — large FLAC albums via RD need more time
```

- [ ] **Step 2: Replace stub processor in index.js**

In `packages/server/src/index.js`, replace lines 558-567:

```javascript
// Before:
const jobWorker = require('./services/job-worker');
// NOTE: downloader.downloadAlbum expects (torrentInfo, rdService) — the pipeline API
// constructs those objects directly. The job queue worker uses a simplified payload
// with {artist, album, magnetLink, sourceMeta}. A dedicated processor will be wired
// when the full pipeline integration is implemented.
jobWorker.setProcessor(async (job) => {
  const payload = JSON.parse(job.payload);
  console.warn(`[job-worker] No processor implemented for job type "${job.type}" (artist: ${payload.artist}, album: ${payload.album}). Skipping.`);
  return {};
});

// After:
const jobWorker = require('./services/job-worker');
jobWorker.setProcessor(require('./services/job-processor').process);
```

- [ ] **Step 3: Add staging cleanup on startup**

In `packages/server/src/index.js`, add after the `migrate()` call (around line 550):

```javascript
// Clean up orphaned staging directories (from crashed jobs)
try {
  const stagingDir = path.join(process.env.MUSIC_DIR || '/app/music', '_staging');
  if (fs.existsSync(stagingDir)) {
    const ONE_HOUR = 60 * 60 * 1000;
    for (const entry of fs.readdirSync(stagingDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const entryPath = path.join(stagingDir, entry.name);
        const stat = fs.statSync(entryPath);
        if (Date.now() - stat.mtimeMs > ONE_HOUR) {
          fs.rmSync(entryPath, { recursive: true, force: true });
          console.log(`[startup] Cleaned up stale staging dir: ${entry.name}`);
        }
      }
    }
  }
} catch (err) {
  console.warn('[startup] Staging cleanup failed:', err.message);
}
```

- [ ] **Step 4: Standardize handleDiscographyDownload payload keys**

In `packages/server/src/services/quality-upgrader.js`, change `handleDiscographyDownload` (lines 130-138):

```javascript
// Before:
async handleDiscographyDownload(magnetLink, targetArtist, targetAlbum) {
  const dedupeKey = `discography-dl:${targetArtist}|${targetAlbum}`;
  const jobId = this.jobQueue.enqueue(
    'download',
    { magnetLink, targetArtist, targetAlbum, isDiscography: true },
    { dedupeKey, priority: 1 }
  );
  return jobId;
}

// After:
async handleDiscographyDownload(magnetLink, targetArtist, targetAlbum) {
  const dedupeKey = `discography-dl:${targetArtist}|${targetAlbum}`;
  const jobId = this.jobQueue.enqueue(
    'download',
    { magnetLink, artist: targetArtist, album: targetAlbum, isDiscography: true },
    { dedupeKey, priority: 1 }
  );
  return jobId;
}
```

- [ ] **Step 5: Wire searchForUpgrade into upgrade.js**

In `packages/server/src/api/upgrade.js`, change the `searchForUpgrade` adapter (around line 85):

```javascript
// Before:
async function searchForUpgrade({ artist, album }) {
  const query = `${artist} ${album}`;
  const results = await getSearchMusic()(query);
  if (!results || results.length === 0) return null;
  return { magnetLink: results[0].magnetLink, sources: results };
}

// After:
async function searchForUpgrade({ artist, album, currentQuality }) {
  const { searchForUpgrade: search } = require('../services/search');
  return search({ artist, album, targetQuality: 'flac', currentQuality });
}
```

- [ ] **Step 6: Run all tests**

Run: `cd packages/server && npx jest --no-cache 2>&1 | tail -5`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/index.js packages/server/src/services/job-worker.js packages/server/src/services/quality-upgrader.js packages/server/src/api/upgrade.js
git commit -m "feat(pipeline): wire job-processor, increase timeout, cleanup staging on startup"
```

---

### Task 8: Integration test — full pipeline flow

**Files:**
- Create: `packages/server/__tests__/services/pipeline-integration.test.js`

- [ ] **Step 1: Write integration test**

```javascript
'use strict';

/**
 * Integration test: upgrade job → quality-upgrader.tick() → enqueues download job →
 * job-processor processes it. Uses mocked external services (RD, MB, network)
 * but real job-queue + job-worker + quality-upgrader + job-processor wiring.
 */

const Database = require('better-sqlite3');

let mockDb;

jest.mock('../../src/services/db', () => ({
  getDb: () => mockDb,
  getGlobalSetting: () => null,
  getUsers: () => [],
}));

jest.mock('../../src/services/realdebrid', () => ({
  addMagnet: jest.fn().mockResolvedValue({ id: 'rd-test' }),
  selectFiles: jest.fn().mockResolvedValue(undefined),
  getTorrentInfo: jest.fn()
    .mockResolvedValueOnce({ status: 'waiting_files_selection', files: [{ id: 1, path: '01 Track.flac', bytes: 30000000 }] })
    .mockResolvedValueOnce({ status: 'downloaded', links: ['https://rd.io/f1'] }),
  unrestrictLink: jest.fn().mockResolvedValue({ download: 'https://dl.rd.io/f1', filename: '01 Track.flac' }),
  deleteTorrent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/downloader', () => ({
  downloadFile: jest.fn().mockResolvedValue('/music/_staging/A/B/01 Track.flac'),
  extractArchive: jest.fn(),
  selectAlbumFiles: jest.fn().mockReturnValue({ fileIds: [1], isDiscography: false }),
  isAudioFile: (f) => /\.(flac|mp3)$/i.test(f),
  isArchive: (f) => /\.(rar|zip)$/i.test(f),
  sanitizePath: (s) => s.replace(/[<>:"/\\|?*]/g, '_').trim(),
}));

jest.mock('../../src/services/file-validator', () => ({
  validateFile: jest.fn().mockResolvedValue({ passed: true, checks: [] }),
}));

jest.mock('../../src/services/download-validator', () => ({
  validate: jest.fn().mockResolvedValue({ score: 0.05, confidence: 'high', details: 'test match' }),
}));

jest.mock('../../src/services/activity-log', () => ({
  log: jest.fn(),
}));

const fs = require('fs');
jest.mock('fs');

describe('pipeline integration', () => {
  let jobQueue;

  beforeEach(() => {
    mockDb = new Database(':memory:');
    mockDb.pragma('journal_mode = WAL');
    jest.clearAllMocks();
    process.env.MUSIC_DIR = '/music';

    fs.mkdirSync.mockReturnValue(undefined);
    fs.renameSync.mockReturnValue(undefined);
    fs.rmSync.mockReturnValue(undefined);
    fs.existsSync.mockReturnValue(false);
    fs.readdirSync.mockReturnValue([]);

    // Fresh job queue on in-memory DB
    jest.resetModules();
    jobQueue = require('../../src/services/job-queue');
  });

  test('enqueue download job → process → success', async () => {
    const jobId = jobQueue.enqueue('download', {
      magnetLink: 'magnet:?xt=urn:btih:test123',
      artist: 'Test Artist',
      album: 'Test Album',
    });

    expect(jobId).toBeGreaterThan(0);

    const job = jobQueue.dequeue('download');
    expect(job).not.toBeNull();
    expect(job.type).toBe('download');

    const { process: processJob } = require('../../src/services/job-processor');
    const result = await processJob(job);
    expect(result.success).toBe(true);
    expect(result.artist).toBe('Test Artist');
  });
});
```

- [ ] **Step 2: Run test**

Run: `cd packages/server && npx jest __tests__/services/pipeline-integration.test.js --no-cache`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `cd packages/server && npx jest --testPathIgnorePatterns="e2e|worktrees" --no-cache 2>&1 | tail -5`
Expected: All tests pass, no regressions

- [ ] **Step 4: Commit**

```bash
git add packages/server/__tests__/services/pipeline-integration.test.js
git commit -m "test(pipeline): add end-to-end pipeline integration test"
```

---

### Task 9: Version bump, changelog, final verification

**Files:**
- Modify: `package.json` (root + all workspaces)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump version to 1.4.0**

```bash
cd /c/Users/natha/.claude/notify && sed -i 's/"version": "1.3.0"/"version": "1.4.0"/g' package.json packages/shared/package.json packages/client/package.json packages/desktop/package.json packages/server/package.json
npm install
```

- [ ] **Step 2: Update CHANGELOG.md**

Add entry for 1.4.0 before the 1.3.0 entry:

```markdown
## [1.4.0] - 2026-03-20

### Added
- Background job processor: wired stub into full download pipeline (magnet → RD → download → validate → replace)
- Download validator: MusicBrainz-based post-download scoring (track count + duration matching with 10s grace)
- LLM-enhanced search: Ollama query expansion generates 3-5 search variations, falls back to programmatic queries
- Torrent result ranking: token-based artist/album matching + quality detection + seeder weighting
- Discography extraction: selectAlbumFiles parses RD file paths to download only the target album
- Staging directory pattern: downloads go to _staging/ first, moved to library only after validation
- Orphaned staging cleanup on server startup (directories older than 1 hour)

### Changed
- Job worker timeout increased from 10 to 20 minutes for large FLAC downloads
- Quality upgrader search now uses multi-query strategy instead of single query
- handleDiscographyDownload payload keys standardized to artist/album
```

- [ ] **Step 3: Build client**

Run: `cd packages/client && npm run build`
Expected: Build succeeds

- [ ] **Step 4: Run full test suite**

Run: `cd packages/server && npx jest --testPathIgnorePatterns="e2e|worktrees" --no-cache`
Expected: All tests pass

- [ ] **Step 5: Commit and push**

```bash
git add package.json package-lock.json packages/*/package.json CHANGELOG.md
git commit -m "chore: bump version to v1.4.0, update changelog"
git push
```

---

### Task 10: LLM Training Circuit (pre-implementation validation)

> **Note:** This task runs AFTER the plan is implemented but BEFORE the LLM search code goes live in production. It validates the prompt template against real data.

**Files:**
- Create: `packages/server/scripts/llm-search-validation.js` (temporary script, not committed)

- [ ] **Step 1: Write validation script**

The script:
1. Loads Spotify Extended Streaming History JSON files from `Spotify Extended Streaming History/`
2. Extracts unique artists, albums, tracks (deduplicated)
3. Random samples: 50 artists, 30 albums, 20 songs
4. For each item, runs `generateSearchQueries()` (20 permutations via LLM)
5. Executes each query against ApiBay via `searchMusic()`
6. Also runs naive baseline query (`"artist album flac"`)
7. Measures: hit rate (found any result), queries needed, LLM vs baseline comparison
8. Reports results to console

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { searchMusic } = require('../src/services/search');
const { generateSearchQueries } = require('../src/services/search');

const HISTORY_DIR = path.join(__dirname, '../../../Spotify Extended Streaming History');

async function main() {
  // Load streaming history
  const files = fs.readdirSync(HISTORY_DIR).filter(f => f.startsWith('Streaming_History_Audio'));
  const allEntries = [];
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, file), 'utf-8'));
    allEntries.push(...data);
  }

  // Extract unique items
  const artists = new Set();
  const albums = new Map(); // "artist|album" -> { artist, album }
  const tracks = new Map(); // "artist|track" -> { artist, track }

  for (const e of allEntries) {
    if (e.master_metadata_album_artist_name) artists.add(e.master_metadata_album_artist_name);
    if (e.master_metadata_album_artist_name && e.master_metadata_album_album_name) {
      const key = `${e.master_metadata_album_artist_name}|${e.master_metadata_album_album_name}`;
      albums.set(key, { artist: e.master_metadata_album_artist_name, album: e.master_metadata_album_album_name });
    }
    if (e.master_metadata_album_artist_name && e.master_metadata_track_name) {
      const key = `${e.master_metadata_album_artist_name}|${e.master_metadata_track_name}`;
      tracks.set(key, { artist: e.master_metadata_album_artist_name, track: e.master_metadata_track_name });
    }
  }

  // Random sample
  function sample(arr, n) {
    const shuffled = [...arr].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, n);
  }

  const artistSample = sample([...artists], 50);
  const albumSample = sample([...albums.values()], 30);
  const trackSample = sample([...tracks.values()], 20);

  console.log(`Sampled: ${artistSample.length} artists, ${albumSample.length} albums, ${trackSample.length} tracks`);
  console.log('---');

  let llmHits = 0, baselineHits = 0, totalTests = 0, falsePositives = 0, llmResultsChecked = 0;
  const { scoreResult } = require('../src/services/search');

  // Test albums (most relevant for upgrader)
  for (const { artist, album } of albumSample) {
    totalTests++;
    console.log(`\nTesting: ${artist} - ${album}`);

    // Baseline
    const baselineResults = await searchMusic(`${artist} ${album} flac`);
    const baselineHit = baselineResults.length > 0;
    if (baselineHit) baselineHits++;

    // LLM-enhanced
    const queries = await generateSearchQueries(artist, album, 'flac');
    let llmHit = false;
    let llmResults = [];
    for (const q of queries) {
      const results = await searchMusic(q);
      llmResults.push(...results);
      if (results.length > 0) { llmHit = true; }
      await new Promise(r => setTimeout(r, 500)); // rate limit
    }
    if (llmHit) llmHits++;

    // False positive check: do top results actually match the target?
    const maxSeeders = Math.max(...llmResults.map(r => r.seeders || 0), 1);
    for (const r of llmResults.slice(0, 5)) { // check top 5
      llmResultsChecked++;
      const s = scoreResult(r.name, artist, album, 'flac', r.seeders || 0, maxSeeders);
      if (s.total < 0.3) falsePositives++; // below threshold = false positive
    }

    console.log(`  Baseline: ${baselineHit ? 'HIT' : 'MISS'} | LLM: ${llmHit ? 'HIT' : 'MISS'} (${queries.length} queries, ${llmResults.length} results)`);
    await new Promise(r => setTimeout(r, 1000)); // rate limit
  }

  const fpRate = llmResultsChecked > 0 ? falsePositives / llmResultsChecked : 0;
  console.log('\n=== RESULTS ===');
  console.log(`Total tests: ${totalTests}`);
  console.log(`Baseline hit rate: ${baselineHits}/${totalTests} (${(baselineHits/totalTests*100).toFixed(1)}%)`);
  console.log(`LLM hit rate: ${llmHits}/${totalTests} (${(llmHits/totalTests*100).toFixed(1)}%)`);
  console.log(`LLM improvement: ${((llmHits - baselineHits)/totalTests*100).toFixed(1)} percentage points`);
  console.log(`False positive rate: ${falsePositives}/${llmResultsChecked} (${(fpRate*100).toFixed(1)}%)`);

  // Success criteria
  const llmRate = llmHits / totalTests;
  const improvement = (llmHits - baselineHits) / totalTests;
  console.log(`\nPass criteria: LLM >= 60% hit rate AND >= 15pp improvement AND <= 10% false positive rate`);
  console.log(`Result: ${llmRate >= 0.6 ? 'PASS' : 'FAIL'} (hit rate) | ${improvement >= 0.15 ? 'PASS' : 'FAIL'} (improvement) | ${fpRate <= 0.10 ? 'PASS' : 'FAIL'} (FP rate)`);
}

main().catch(console.error);
```

- [ ] **Step 2: Run the validation**

Run: `cd packages/server && node scripts/llm-search-validation.js`

This requires Ollama running with qwen3:4b loaded. If Ollama is unavailable, the script tests the fallback path only (baseline vs baseline — useful for verifying the test harness works).

- [ ] **Step 3: Review results and tune prompt if needed**

If hit rate < 60% or improvement < 15pp, adjust the LLM prompt template in `search.js` `generateSearchQueries()` and re-run.

- [ ] **Step 4: Delete the script (not committed)**

```bash
rm packages/server/scripts/llm-search-validation.js
```

---
