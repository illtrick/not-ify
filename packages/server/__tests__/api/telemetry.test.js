'use strict';

// Telemetry API tests

jest.mock('../../src/services/search', () => ({ searchMusic: jest.fn() }));
jest.mock('../../src/services/musicbrainz', () => ({
  searchReleases: jest.fn().mockResolvedValue([]),
  searchArtists: jest.fn().mockResolvedValue([]),
  browseArtistReleases: jest.fn().mockResolvedValue([]),
  getReleaseTracks: jest.fn().mockResolvedValue([]),
  getReleaseGroupTracks: jest.fn().mockResolvedValue({ releaseMbid: null, tracks: [] }),
}));
jest.mock('../../src/services/youtube', () => ({
  searchYouTube: jest.fn().mockResolvedValue([]),
  searchSoundCloud: jest.fn().mockResolvedValue([]),
  getStreamUrl: jest.fn(),
}));
jest.mock('../../src/services/llm', () => ({
  getCachedParse: jest.fn().mockReturnValue(null),
  parseTorrentNamesAsync: jest.fn(),
  checkHealth: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/services/realdebrid');
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

const request = require('supertest');
const app = require('../../src/index');
const telemetry = require('../../src/api/telemetry');

// Clear the ring buffer between tests
beforeEach(() => {
  telemetry._test.entries.length = 0;
});

describe('POST /api/telemetry', () => {
  test('returns 204 with valid events', async () => {
    const res = await request(app)
      .post('/api/telemetry')
      .send({
        events: [
          { traceId: 'abc-123', event: 'playback_start', trackId: 'track-1', timestamp: Date.now(), latencyMs: 42 },
          { traceId: 'abc-123', event: 'buffer_ready', trackId: 'track-1', timestamp: Date.now() },
        ],
      });
    expect(res.status).toBe(204);
    expect(telemetry._test.entries.length).toBe(2);
  });

  test('returns 400 with empty body', async () => {
    const res = await request(app)
      .post('/api/telemetry')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/events/i);
  });

  test('returns 400 with empty events array', async () => {
    const res = await request(app)
      .post('/api/telemetry')
      .send({ events: [] });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/telemetry', () => {
  test('returns recent entries', async () => {
    // Seed some entries
    telemetry._test.ingest({ event: 'playback_start', traceId: 't1', trackId: 'tk1' });
    telemetry._test.ingest({ event: 'buffer_ready', traceId: 't1', trackId: 'tk1' });
    telemetry._test.ingest({ event: 'playback_start', traceId: 't2', trackId: 'tk2' });

    const res = await request(app).get('/api/telemetry');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(3);
    expect(res.body[0].event).toBe('playback_start');
  });

  test('filters by traceId', async () => {
    telemetry._test.ingest({ event: 'playback_start', traceId: 'trace-a', trackId: 'tk1' });
    telemetry._test.ingest({ event: 'playback_start', traceId: 'trace-b', trackId: 'tk2' });
    telemetry._test.ingest({ event: 'buffer_ready', traceId: 'trace-a', trackId: 'tk1' });

    const res = await request(app).get('/api/telemetry?traceId=trace-a');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body.every(e => e.traceId === 'trace-a')).toBe(true);
  });

  test('filters by event type', async () => {
    telemetry._test.ingest({ event: 'playback_start', traceId: 't1' });
    telemetry._test.ingest({ event: 'stall', traceId: 't1' });
    telemetry._test.ingest({ event: 'playback_start', traceId: 't2' });

    const res = await request(app).get('/api/telemetry?event=stall');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].event).toBe('stall');
  });

  test('returns at most 100 entries', async () => {
    for (let i = 0; i < 150; i++) {
      telemetry._test.ingest({ event: 'tick', traceId: `t-${i}` });
    }
    const res = await request(app).get('/api/telemetry');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(100);
  });
});
