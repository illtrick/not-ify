'use strict';

// Suite — File validation integration in the download pipeline
//
// Tests that:
//   1. A direct audio file that fails validation is deleted and not added to the library.
//   2. A direct audio file that passes validation IS added to the library.
//   3. A YouTube download that fails validation is deleted and the queue entry enters error state.
//   4. A YouTube download that passes validation completes successfully.

// ---------------------------------------------------------------------------
// Global service mocks
// ---------------------------------------------------------------------------
jest.mock('../../src/services/search', () => ({ searchMusic: jest.fn().mockResolvedValue([]) }));
jest.mock('../../src/services/musicbrainz', () => ({
  searchReleases: jest.fn().mockResolvedValue([]),
  searchArtists: jest.fn().mockResolvedValue([]),
  browseArtistReleases: jest.fn().mockResolvedValue([]),
  getReleaseTracks: jest.fn().mockResolvedValue([]),
  getReleaseGroupTracks: jest.fn().mockResolvedValue({ releaseMbid: null, tracks: [] }),
}));
jest.mock('../../src/services/llm', () => ({
  getCachedParse: jest.fn().mockReturnValue(null),
  parseTorrentNamesAsync: jest.fn(),
  checkHealth: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../src/services/lastfm', () => ({}));
jest.mock('../../src/services/migrate', () => ({ migrate: jest.fn() }));
jest.mock('../../src/services/job-queue', () => ({
  enqueue: jest.fn(), dequeue: jest.fn(), complete: jest.fn(), fail: jest.fn(),
  skip: jest.fn(), getByType: jest.fn().mockReturnValue([]),
  getByStatus: jest.fn().mockReturnValue([]),
  getAll: jest.fn().mockReturnValue([]), getStats: jest.fn().mockReturnValue({}),
}));
jest.mock('../../src/services/db', () => ({
  getDb: jest.fn(), isValidUser: jest.fn().mockReturnValue(true),
  isSetupComplete: jest.fn().mockReturnValue(true),
  getDefaultUserId: jest.fn().mockReturnValue('default'),
  getUsers: jest.fn().mockReturnValue([]),
  getRecentlyPlayed: jest.fn().mockReturnValue([]),
  addRecentlyPlayed: jest.fn().mockReturnValue([]),
  bulkSetRecentlyPlayed: jest.fn().mockReturnValue([]),
  getLastfmConfig: jest.fn().mockReturnValue({}),
  saveLastfmConfig: jest.fn(), clearLastfmConfig: jest.fn(),
  getScrobbleQueue: jest.fn().mockReturnValue([]),
  addToScrobbleQueue: jest.fn(), removeFromScrobbleQueue: jest.fn(),
  getAllUsersWithScrobbleQueue: jest.fn().mockReturnValue([]),
  getGlobalSetting: jest.fn(), setGlobalSetting: jest.fn(),
  getUserSetting: jest.fn(), setUserSetting: jest.fn(),
  getAllUserSettings: jest.fn().mockReturnValue({}),
  getSearchHistory: jest.fn().mockReturnValue([]),
  addSearchHistory: jest.fn(), removeSearchHistory: jest.fn(), clearSearchHistory: jest.fn(),
  getFavorites: jest.fn().mockReturnValue([]),
  addFavorite: jest.fn(), removeFavorite: jest.fn(),
  isFavorite: jest.fn().mockReturnValue(false),
  getUserSession: jest.fn().mockReturnValue({ queue: [], state: {} }),
  saveUserSession: jest.fn(),
}));
jest.mock('../../src/services/youtube', () => ({
  searchYouTube: jest.fn().mockResolvedValue([]),
  searchSoundCloud: jest.fn().mockResolvedValue([]),
  getStreamUrl: jest.fn().mockResolvedValue('https://stream.example.com/audio.mp4'),
}));

// ---------------------------------------------------------------------------
// validateFile mock — variable MUST be prefixed "mock" for Jest hoisting.
// ---------------------------------------------------------------------------
const mockValidateFile = jest.fn();
jest.mock('../../src/services/file-validator', () => ({
  validateFile: mockValidateFile,
}));

// ---------------------------------------------------------------------------
// Real-Debrid mock — single unrestricted audio file
// ---------------------------------------------------------------------------
jest.mock('../../src/services/realdebrid', () => ({
  addMagnet: jest.fn().mockResolvedValue({ id: 'torrent-1' }),
  selectFiles: jest.fn().mockResolvedValue({}),
  getTorrentInfo: jest.fn().mockResolvedValue({
    status: 'downloaded',
    filename: 'Test Artist - Test Album',
    original_filename: 'Test Artist - Test Album',
    links: ['https://rd.example.com/file1'],
    progress: 100,
  }),
  unrestrictLink: jest.fn().mockResolvedValue({
    filename: 'track01.mp3',
    download: 'https://rd-download.example.com/track01.mp3',
    filesize: 5 * 1024 * 1024,
  }),
  deleteTorrent: jest.fn().mockResolvedValue({}),
}));

// ---------------------------------------------------------------------------
// library-check mock — resolveAlbumDir returns a simple path
// ---------------------------------------------------------------------------
jest.mock('../../src/services/library-check', () => ({
  ...jest.requireActual('../../src/services/library-check'),
  resolveAlbumDir: (rgid, artist, album) => {
    const sanitize = (s) => (s || 'Unknown').replace(/[:]/g, '-').replace(/[<>"/\\|?*]/g, '_').trim();
    return `/music/${sanitize(artist)}/${sanitize(album)}`;
  },
}));

// ---------------------------------------------------------------------------
// downloader mock — fake downloadFile that writes nothing to disk
// ---------------------------------------------------------------------------
jest.mock('../../src/services/downloader', () => {
  const actual = jest.requireActual('../../src/services/downloader');
  return {
    ...actual,
    downloadFile: jest.fn().mockResolvedValue('/music/Test Artist/Test Album/track01.mp3'),
    extractArchive: jest.fn().mockResolvedValue([]),
  };
});

// ---------------------------------------------------------------------------
// child_process mock — always exits 0, reports a destination file
// ---------------------------------------------------------------------------
jest.mock('child_process', () => ({
  spawn: jest.fn(() => {
    const EventEmitter = require('events');
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = jest.fn();
    setImmediate(() => {
      proc.stdout.emit('data', 'Destination: /music/Unknown Artist/Singles/Good Track.mp3\n');
      proc.emit('close', 0);
    });
    return proc;
  }),
}));

// ---------------------------------------------------------------------------
// fs mock — avoid touching real disk; track unlinkSync calls
// ---------------------------------------------------------------------------
const mockFsUnlinkSync = jest.fn();
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  mkdirSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(true),
  readdirSync: jest.fn().mockReturnValue(['track.mp3']),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn().mockReturnValue('{}'),
  unlinkSync: mockFsUnlinkSync,
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
const request = require('supertest');
const app = require('../../src/index');

beforeEach(() => {
  mockFsUnlinkSync.mockClear();
  mockValidateFile.mockClear();
});

// ---------------------------------------------------------------------------
// Torrent / RD path
// ---------------------------------------------------------------------------
describe('Pipeline validation — torrent path', () => {
  test('FAILING: file that fails validation is deleted and not counted', async () => {
    mockValidateFile.mockResolvedValue({
      passed: false,
      path: '/music/Test Artist/Test Album/track01.mp3',
      checks: [{ name: 'ffprobe', passed: false, detail: 'invalid data' }],
    });

    const res = await request(app)
      .post('/api/download')
      .send({
        magnetLink: 'magnet:?xt=urn:btih:abc123',
        name: 'Test Artist - Test Album',
        artist: 'Test Artist',
        albumName: 'Test Album',
      });

    const events = parseSSEEvents(res.text);
    const completeEvent = events.find(e => e.type === 'complete');

    // The bad file must be deleted
    expect(mockFsUnlinkSync).toHaveBeenCalled();
    // Complete event must report 0 tracks placed in library
    expect(completeEvent).toBeDefined();
    expect(completeEvent.fileCount).toBe(0);
  });

  test('file that passes validation is kept and counted', async () => {
    mockValidateFile.mockResolvedValue({
      passed: true,
      path: '/music/Test Artist/Test Album/track01.mp3',
      checks: [{ name: 'ffprobe', passed: true, detail: 'mp3, 192kbps' }],
    });

    const res = await request(app)
      .post('/api/download')
      .send({
        magnetLink: 'magnet:?xt=urn:btih:abc123',
        name: 'Test Artist - Test Album',
        artist: 'Test Artist',
        albumName: 'Test Album',
      });

    const events = parseSSEEvents(res.text);
    const completeEvent = events.find(e => e.type === 'complete');

    expect(mockFsUnlinkSync).not.toHaveBeenCalled();
    expect(completeEvent).toBeDefined();
    expect(completeEvent.fileCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// YouTube path
// ---------------------------------------------------------------------------
describe('Pipeline validation — YouTube path', () => {
  test('FAILING: YouTube file that fails validation is deleted and queue entry errors', async () => {
    mockValidateFile.mockResolvedValue({
      passed: false,
      path: '/music/Unknown Artist/Singles/Good Track.mp3',
      checks: [{ name: 'mime', passed: false, detail: 'application/octet-stream' }],
    });

    await request(app)
      .post('/api/download/yt')
      .send({
        url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
        title: 'Good Track',
        artist: 'Unknown Artist',
        album: 'Singles',
      });

    // Allow the queue processor to run (includes 5s retry backoff + retry attempt)
    await new Promise(r => setTimeout(r, 8000));

    const queueRes = await request(app).get('/api/download/yt/queue');

    expect(mockFsUnlinkSync).toHaveBeenCalled();
    expect(queueRes.body.errors).toBeGreaterThan(0);
  }, 15000);

  test('YouTube file that passes validation completes successfully', async () => {
    mockValidateFile.mockResolvedValue({
      passed: true,
      path: '/music/Unknown Artist/Singles/Good Track.mp3',
      checks: [{ name: 'ffprobe', passed: true, detail: 'mp3, 320kbps' }],
    });

    // Snapshot queue state before queuing so we can measure the delta
    const before = await request(app).get('/api/download/yt/queue');
    const completedBefore = before.body.completed;
    const errorsBefore = before.body.errors;

    await request(app)
      .post('/api/download/yt')
      .send({
        url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
        title: 'Good Track',
        artist: 'Unknown Artist',
        album: 'Singles',
      });

    // Allow the queue processor to run (includes 3s cooldown between batches)
    await new Promise(r => setTimeout(r, 5000));

    const queueRes = await request(app).get('/api/download/yt/queue');
    // A new entry completed successfully
    expect(queueRes.body.completed).toBeGreaterThan(completedBefore);
    // No new errors were added
    expect(queueRes.body.errors).toBe(errorsBefore);
  }, 15000);
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function parseSSEEvents(text) {
  if (!text) return [];
  return text
    .split('\n')
    .filter(line => line.startsWith('data: '))
    .map(line => {
      try { return JSON.parse(line.slice(6)); } catch { return null; }
    })
    .filter(Boolean);
}
