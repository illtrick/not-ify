'use strict';

// Suite B7 — Health and status routes

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
const llm = require('../../src/services/llm');
const rd = require('../../src/services/realdebrid');

describe('GET /api/health', () => {
  test('returns 200 with ok status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('not-ify-server');
  });
});

describe('GET /api/llm/health', () => {
  test('returns ok when Ollama available', async () => {
    llm.checkHealth.mockResolvedValue(true);
    const res = await request(app).get('/api/llm/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('returns unavailable when Ollama down', async () => {
    llm.checkHealth.mockResolvedValue(false);
    const res = await request(app).get('/api/llm/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('unavailable');
  });
});

