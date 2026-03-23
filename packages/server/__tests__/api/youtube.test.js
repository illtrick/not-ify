'use strict';

// Suite B5 — YouTube queue routes

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
jest.mock('../../src/services/realdebrid', () => ({}));
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

// Mock youtube service so searches work without yt-dlp
jest.mock('../../src/services/youtube', () => ({
  searchYouTube: jest.fn().mockResolvedValue([
    { id: 'abc1234abcd', title: 'Test Song', duration: 180, channel: 'TestChannel', thumbnail: 'https://img.yt/1.jpg', url: 'https://youtube.com/watch?v=abc1234abcd' },
  ]),
  searchSoundCloud: jest.fn().mockResolvedValue([]),
  getStreamUrl: jest.fn().mockResolvedValue('https://stream.example.com/audio.mp4'),
}));

// Mock child_process.spawn so yt-dlp downloads don't actually run
jest.mock('child_process', () => ({
  spawn: jest.fn(() => {
    const EventEmitter = require('events');
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = jest.fn();
    // Simulate successful completion after a tick
    setImmediate(() => {
      proc.emit('close', 0);
    });
    return proc;
  }),
}));

// Mock fs so file writes don't touch disk
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    mkdirSync: jest.fn(),
    existsSync: jest.fn().mockReturnValue(true),
    readdirSync: jest.fn().mockReturnValue(['track.mp3']),
    writeFileSync: jest.fn(),
    readFileSync: jest.fn().mockReturnValue('{}'),
    unlinkSync: jest.fn(),
  };
});

const request = require('supertest');
const app = require('../../src/index');

// ---------------------------------------------------------------------------
// GET /api/yt/search
// ---------------------------------------------------------------------------
describe('GET /api/yt/search', () => {
  test('returns 200 with results array', async () => {
    const res = await request(app).get('/api/yt/search?q=test+song');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toHaveProperty('id');
    expect(res.body[0]).toHaveProperty('title');
  });

  test('returns 400 when q is missing', async () => {
    const res = await request(app).get('/api/yt/search');
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/yt/stream/:videoId
// ---------------------------------------------------------------------------
describe('GET /api/yt/stream/:videoId', () => {
  test('returns 400 for invalid video ID (not 11 chars)', async () => {
    const res = await request(app).get('/api/yt/stream/tooshort');
    expect(res.status).toBe(400);
  });

  test('returns 400 for ID with invalid chars', async () => {
    const res = await request(app).get('/api/yt/stream/abc!@#$%^&*(');
    expect(res.status).toBe(400);
  });

  test('valid video ID does not return 400', async () => {
    // getStreamUrl is mocked to return a URL — server will try to proxy it
    // We just verify the ID validation passes (actual proxy may error without real network)
    const res = await request(app).get('/api/yt/stream/dQw4w9WgXcQ');
    expect(res.status).not.toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/download/yt — queue a download
// ---------------------------------------------------------------------------
describe('POST /api/download/yt', () => {
  test('queues download and returns queued status', async () => {
    const res = await request(app)
      .post('/api/download/yt')
      .send({
        url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
        title: 'Test Track',
        artist: 'Test Artist',
        album: 'Test Album',
      });
    expect(res.status).toBe(200);
    expect(res.body.queued).toBe(true);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('position');
  });

  test('returns 400 when url is missing', async () => {
    const res = await request(app)
      .post('/api/download/yt')
      .send({ title: 'No URL Track' });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/download/yt/batch
// ---------------------------------------------------------------------------
describe('POST /api/download/yt/batch', () => {
  test('queues multiple tracks', async () => {
    const res = await request(app)
      .post('/api/download/yt/batch')
      .send({
        tracks: [
          { url: 'https://youtube.com/watch?v=aaaaaaaaaaa', title: 'Track 1', artist: 'Artist', album: 'Album' },
          { url: 'https://youtube.com/watch?v=bbbbbbbbbbb', title: 'Track 2', artist: 'Artist', album: 'Album' },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.queued).toBe(2);
    expect(Array.isArray(res.body.ids)).toBe(true);
    expect(res.body.ids).toHaveLength(2);
  });

  test('returns 400 for empty tracks array', async () => {
    const res = await request(app)
      .post('/api/download/yt/batch')
      .send({ tracks: [] });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/download/yt/queue
// ---------------------------------------------------------------------------
describe('GET /api/download/yt/queue', () => {
  test('returns queue status shape', async () => {
    const res = await request(app).get('/api/download/yt/queue');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('queued');
    expect(res.body).toHaveProperty('completed');
    expect(res.body).toHaveProperty('errors');
    expect(res.body).toHaveProperty('total');
  });
});
