'use strict';

jest.mock('../../src/services/dlna');
jest.mock('node-ssdp', () => ({
  Client: jest.fn().mockImplementation(() => ({
    on: jest.fn(), search: jest.fn(), stop: jest.fn(),
  })),
}));
jest.mock('upnp-client-ts', () => ({
  UpnpMediaRendererClient: jest.fn(),
}));
jest.mock('../../src/services/db', () => ({
  getDb: jest.fn(),
  isValidUser: jest.fn().mockReturnValue(true),
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
jest.mock('../../src/services/migrate', () => ({ migrate: jest.fn() }));
jest.mock('../../src/services/realdebrid', () => ({}));
jest.mock('../../src/services/search', () => ({ searchMusic: jest.fn().mockResolvedValue([]) }));
jest.mock('../../src/services/musicbrainz', () => ({
  searchReleases: jest.fn().mockResolvedValue([]),
  searchArtists: jest.fn().mockResolvedValue([]),
  getArtistDetails: jest.fn().mockResolvedValue(null),
  normalizeQuery: jest.fn(q => q),
}));
jest.mock('../../src/services/youtube', () => ({
  search: jest.fn().mockResolvedValue([]),
  getStreamUrl: jest.fn().mockResolvedValue('http://example.com/stream'),
}));
jest.mock('../../src/services/llm', () => ({ checkHealth: jest.fn().mockResolvedValue(false) }));
jest.mock('../../src/services/lastfm', () => ({}));
jest.mock('../../src/services/stream-auth', () => ({
  generateSignedUrl: jest.fn((id, base) => `${base}/api/stream/${id}?sig=testhash&exp=9999999999`),
  generateSignedYtUrl: jest.fn((id, base) => `${base}/api/yt/stream/${id}?sig=testhash&exp=9999999999`),
  verifySignature: jest.fn().mockReturnValue(true),
}));

const request = require('supertest');
const app = require('../../src/index');
const dlna = require('../../src/services/dlna');
const castSession = require('../../src/services/cast-session');

const DEVICE = { usn: 'uuid:test-device', friendlyName: 'Test Speaker', ip: '192.168.1.50', location: 'http://192.168.1.50:1400/desc', lastSeen: Date.now() };

beforeEach(() => {
  jest.clearAllMocks();
  dlna.getDevices.mockReturnValue([DEVICE]);
  dlna.play.mockResolvedValue(undefined);
  dlna.pause.mockResolvedValue(undefined);
  dlna.stop.mockResolvedValue(undefined);
  dlna.seek.mockResolvedValue(undefined);
  dlna.setVolume.mockResolvedValue(undefined);
  dlna.getVolume.mockResolvedValue(50);
  dlna.getPosition.mockResolvedValue({ position: 30, duration: 180, trackURI: '' });
  dlna.getTransportState.mockResolvedValue('PLAYING');
  dlna.buildDidlLite.mockReturnValue('<DIDL-Lite/>');
  dlna.on.mockImplementation(() => {});
  dlna.off.mockImplementation(() => {});
  castSession.clearSession('default');
});

// ── Devices ───────────────────────────────────────────────────────────────────

describe('GET /api/cast/devices', () => {
  test('returns array of devices', async () => {
    const res = await request(app).get('/api/cast/devices');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toHaveProperty('usn', DEVICE.usn);
    expect(res.body[0]).toHaveProperty('friendlyName', DEVICE.friendlyName);
  });
});

// ── Play YT ───────────────────────────────────────────────────────────────────

describe('POST /api/cast/play/yt', () => {
  test('calls dlna.play and returns playing status', async () => {
    const res = await request(app)
      .post('/api/cast/play/yt')
      .send({ deviceUsn: DEVICE.usn, videoId: 'dQw4w9WgXcQ', title: 'Never Gonna Give You Up', artist: 'Rick Astley', album: '', coverArt: '' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('playing');
    expect(dlna.play).toHaveBeenCalledTimes(1);
    const [calledUsn, streamUrl] = dlna.play.mock.calls[0];
    expect(calledUsn).toBe(DEVICE.usn);
    expect(streamUrl).toMatch(/\/api\/yt\/stream\/dQw4w9WgXcQ\?sig=.+&exp=\d+/);
  });

  test('returns 400 when deviceUsn is missing', async () => {
    const res = await request(app).post('/api/cast/play/yt').send({ videoId: 'abc' });
    expect(res.status).toBe(400);
  });

  test('returns 400 when videoId is missing', async () => {
    const res = await request(app).post('/api/cast/play/yt').send({ deviceUsn: DEVICE.usn });
    expect(res.status).toBe(400);
  });

  test('returns 500 when dlna.play throws', async () => {
    dlna.play.mockRejectedValue(new Error('Device unreachable'));
    const res = await request(app)
      .post('/api/cast/play/yt')
      .send({ deviceUsn: DEVICE.usn, videoId: 'dQw4w9WgXcQ', title: 'T', artist: 'A', album: '', coverArt: '' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Device unreachable');
  });
});

// ── Pause ─────────────────────────────────────────────────────────────────────

describe('POST /api/cast/pause', () => {
  test('calls dlna.pause', async () => {
    const res = await request(app).post('/api/cast/pause').send({ deviceUsn: DEVICE.usn });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paused');
    expect(dlna.pause).toHaveBeenCalledWith(DEVICE.usn);
  });

  test('returns 400 when deviceUsn missing', async () => {
    const res = await request(app).post('/api/cast/pause').send({});
    expect(res.status).toBe(400);
  });
});

// ── Stop ──────────────────────────────────────────────────────────────────────

describe('POST /api/cast/stop', () => {
  test('calls dlna.stop and clears session', async () => {
    const res = await request(app).post('/api/cast/stop').send({ deviceUsn: DEVICE.usn });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('stopped');
    expect(dlna.stop).toHaveBeenCalledWith(DEVICE.usn);
  });
});

// ── Seek ──────────────────────────────────────────────────────────────────────

describe('POST /api/cast/seek', () => {
  test('calls dlna.seek with numeric position', async () => {
    const res = await request(app).post('/api/cast/seek').send({ deviceUsn: DEVICE.usn, position: 45 });
    expect(res.status).toBe(200);
    expect(dlna.seek).toHaveBeenCalledWith(DEVICE.usn, 45);
  });

  test('returns 400 when position missing', async () => {
    const res = await request(app).post('/api/cast/seek').send({ deviceUsn: DEVICE.usn });
    expect(res.status).toBe(400);
  });
});

// ── Volume ────────────────────────────────────────────────────────────────────

describe('POST /api/cast/volume', () => {
  test('calls dlna.setVolume', async () => {
    const res = await request(app).post('/api/cast/volume').send({ deviceUsn: DEVICE.usn, level: 75 });
    expect(res.status).toBe(200);
    expect(dlna.setVolume).toHaveBeenCalledWith(DEVICE.usn, 75);
  });
});

// ── Status ────────────────────────────────────────────────────────────────────

describe('GET /api/cast/status', () => {
  test('returns position, duration, state, volume', async () => {
    const res = await request(app).get(`/api/cast/status?deviceUsn=${encodeURIComponent(DEVICE.usn)}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('position', 30);
    expect(res.body).toHaveProperty('duration', 180);
    expect(res.body).toHaveProperty('state', 'PLAYING');
    expect(res.body).toHaveProperty('volume', 50);
  });

  test('returns 400 when deviceUsn missing', async () => {
    const res = await request(app).get('/api/cast/status');
    expect(res.status).toBe(400);
  });
});
