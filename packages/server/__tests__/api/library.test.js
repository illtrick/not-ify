'use strict';

// Suite B3 — Library routes: GET /api/library, GET /api/stream/:id,
//            DELETE /api/library/album, DELETE /api/library/track/:id,
//            POST /api/library/dedupe
//
// Strategy: mock 'fs' with memfs at module level (hoisted before any require),
// load the app once, and reset vol state in beforeEach.
// This ensures the app and tests share a single memfs instance.

// All jest.mock calls are hoisted before any require() by Jest
jest.mock('fs', () => {
  const { fs: memfs } = require('memfs');
  return memfs;
});

jest.mock('../../src/services/search', () => ({ searchMusic: jest.fn().mockResolvedValue([]) }));
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
  checkHealth: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../src/services/lastfm', () => ({}));
jest.mock('../../src/services/realdebrid', () => ({}));
jest.mock('../../src/services/migrate', () => ({ migrate: jest.fn() }));
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

// Require after mocks are applied — vol and app share the same memfs instance
const { vol } = require('memfs');
const path = require('path');
const crypto = require('crypto');
const request = require('supertest');
const app = require('../../src/index');

// Reset virtual filesystem between tests
beforeEach(() => {
  vol.reset();
  vol.mkdirSync('/app/music', { recursive: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Build the same file ID that library.js produces: MD5 of the full path.
// On Windows, path.join uses backslashes, so we must match that.
function fileId(p) {
  return crypto.createHash('md5').update(p).digest('hex');
}

// Write a fake audio file to the virtual FS; returns the full path as library.js
// would see it (using path.join so separators match on any OS).
function createTrack(artist, album, filename, content = Buffer.alloc(100)) {
  const dir = path.join('/app/music', artist, album);
  vol.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, filename);
  vol.writeFileSync(fp, content);
  return fp;
}

function createMeta(artist, album, meta) {
  const dir = path.join('/app/music', artist, album);
  vol.mkdirSync(dir, { recursive: true });
  vol.writeFileSync(path.join(dir, '.metadata.json'), JSON.stringify(meta));
}

// ---------------------------------------------------------------------------
// GET /api/library
// ---------------------------------------------------------------------------
describe('GET /api/library', () => {
  test('returns empty array when music dir is empty', async () => {
    const res = await request(app).get('/api/library');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('returns tracks from music directory', async () => {
    createTrack('Pink Floyd', 'Animals', '01-Pigs.mp3');
    const res = await request(app).get('/api/library');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test('track has expected shape', async () => {
    createTrack('Pink Floyd', 'Animals', '01-Pigs.mp3');
    const res = await request(app).get('/api/library');
    const track = res.body[0];
    expect(track).toHaveProperty('id');
    expect(track).toHaveProperty('title');
    expect(track).toHaveProperty('artist', 'Pink Floyd');
    expect(track).toHaveProperty('album', 'Animals');
    expect(track).toHaveProperty('format', 'mp3');
    expect(track).toHaveProperty('path');
    expect(track.path).toMatch(/^\/api\/stream\//);
  });

  test('_fullPath is NOT exposed in response', async () => {
    createTrack('Pink Floyd', 'Animals', 'track.mp3');
    const res = await request(app).get('/api/library');
    expect(res.body[0]).not.toHaveProperty('_fullPath');
  });

  test('inherits metadata from .metadata.json', async () => {
    createMeta('Radiohead', 'OK Computer', { coverArt: 'http://cover.jpg', mbid: 'mb-123', year: '1997' });
    createTrack('Radiohead', 'OK Computer', 'track1.flac');
    const res = await request(app).get('/api/library');
    expect(res.body[0].coverArt).toBe('http://cover.jpg');
    expect(res.body[0].mbid).toBe('mb-123');
    expect(res.body[0].year).toBe('1997');
  });

  test('multiple tracks in multiple albums', async () => {
    createTrack('Pink Floyd', 'Animals', 'track1.flac');
    createTrack('Pink Floyd', 'The Wall', 'track1.mp3');
    createTrack('Radiohead', 'OK Computer', 'track1.flac');
    const res = await request(app).get('/api/library');
    expect(res.body).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// GET /api/stream/:id
// ---------------------------------------------------------------------------
describe('GET /api/stream/:id', () => {
  test('404 for unknown track id', async () => {
    const res = await request(app).get('/api/stream/deadbeef00000000000000000000dead');
    expect(res.status).toBe(404);
  });

  test('200 with audio content for known track', async () => {
    const fp = createTrack('Artist', 'Album', 'track.mp3', Buffer.from('fake-audio-data'));
    const id = fileId(fp);
    const res = await request(app).get(`/api/stream/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/audio\/mpeg/);
  });

  test('correct MIME type for FLAC', async () => {
    const fp = createTrack('Artist', 'Album', 'track.flac', Buffer.from('fake'));
    const id = fileId(fp);
    const res = await request(app).get(`/api/stream/${id}`);
    expect(res.headers['content-type']).toMatch(/audio\/flac/);
  });

  test('range request returns 206', async () => {
    const fp = createTrack('Artist', 'Album', 'track.mp3', Buffer.alloc(10000));
    const id = fileId(fp);
    const res = await request(app)
      .get(`/api/stream/${id}`)
      .set('Range', 'bytes=0-999');
    expect(res.status).toBe(206);
    expect(res.headers).toHaveProperty('content-range');
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/library/album
// ---------------------------------------------------------------------------
describe('DELETE /api/library/album', () => {
  test('400 when artist or album missing', async () => {
    const res = await request(app).delete('/api/library/album').send({ artist: 'Pink Floyd' });
    expect(res.status).toBe(400);
  });

  test('404 when album does not exist', async () => {
    const res = await request(app).delete('/api/library/album').send({ artist: 'Nobody', album: 'Nothing' });
    expect(res.status).toBe(404);
  });

  test('removes album and returns count', async () => {
    createTrack('Pink Floyd', 'Animals', 'track1.mp3');
    createTrack('Pink Floyd', 'Animals', 'track2.mp3');
    const res = await request(app).delete('/api/library/album').send({ artist: 'Pink Floyd', album: 'Animals' });
    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(2);
    // Directory should be gone from the virtual FS
    const albumDir = path.join('/app/music', 'Pink Floyd', 'Animals');
    expect(vol.existsSync(albumDir)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/library/track/:id
// ---------------------------------------------------------------------------
describe('DELETE /api/library/track/:id', () => {
  test('404 for unknown track', async () => {
    const res = await request(app).delete('/api/library/track/deadbeef00000000deadbeef00000000');
    expect(res.status).toBe(404);
  });

  test('removes track file', async () => {
    const fp = createTrack('Artist', 'Album', 'track.mp3');
    const id = fileId(fp);
    const res = await request(app).delete(`/api/library/track/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(1);
    expect(vol.existsSync(fp)).toBe(false);
  });

  test('cleans up empty album directory after last track removed', async () => {
    const fp = createTrack('Artist', 'Album', 'only-track.mp3');
    const id = fileId(fp);
    await request(app).delete(`/api/library/track/${id}`);
    const albumDir = path.join('/app/music', 'Artist', 'Album');
    expect(vol.existsSync(albumDir)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /api/library/dedupe
// ---------------------------------------------------------------------------
describe('POST /api/library/dedupe', () => {
  test('returns scanned count and removed count', async () => {
    createTrack('Artist', 'Album', '01 Track.mp3', Buffer.alloc(100));
    const res = await request(app).post('/api/library/dedupe');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('scanned');
    expect(res.body).toHaveProperty('removed');
  });

  test('removes MP3 when FLAC of same track exists', async () => {
    // Same normalized title, FLAC wins
    createTrack('Artist', 'Album', '01 Track One.mp3', Buffer.alloc(50));
    createTrack('Artist', 'Album', '01 Track One.flac', Buffer.alloc(200));
    const res = await request(app).post('/api/library/dedupe');
    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(1);
    const flacPath = path.join('/app/music', 'Artist', 'Album', '01 Track One.flac');
    const mp3Path  = path.join('/app/music', 'Artist', 'Album', '01 Track One.mp3');
    expect(vol.existsSync(flacPath)).toBe(true);
    expect(vol.existsSync(mp3Path)).toBe(false);
  });

  test('no removal when no duplicates', async () => {
    createTrack('Artist', 'Album', 'unique-track.flac');
    const res = await request(app).post('/api/library/dedupe');
    expect(res.body.removed).toBe(0);
  });
});
