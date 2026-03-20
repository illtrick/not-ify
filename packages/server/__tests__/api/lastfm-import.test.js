'use strict';

// Suite — POST /api/import/lastfm
// Tests the scrobble-based library import endpoint.
// Uses real SQLite (in-process, temp dir) + real library-check (real fs) + real job-queue.
// External services mocked to prevent network calls / side effects.

const os = require('os');
const path = require('path');

// Use a unique temp dir per test run so parallel runs don't conflict
const TEST_CONFIG_DIR = path.join(os.tmpdir(), `notify-test-${Date.now()}-${process.pid}`);
const TEST_MUSIC_DIR = path.join(os.tmpdir(), `notify-music-${Date.now()}-${process.pid}`);

process.env.CONFIG_DIR = TEST_CONFIG_DIR;
process.env.MUSIC_DIR = TEST_MUSIC_DIR;

// Mock external services that make network calls
jest.mock('../../src/services/search', () => ({ searchMusic: jest.fn().mockResolvedValue([]) }));
jest.mock('../../src/services/musicbrainz', () => ({
  searchReleases: jest.fn().mockResolvedValue([]),
  searchArtists: jest.fn().mockResolvedValue([]),
  browseArtistReleases: jest.fn().mockResolvedValue([]),
  getReleaseTracks: jest.fn().mockResolvedValue([]),
  getReleaseGroupTracks: jest.fn().mockResolvedValue({ releaseMbid: null, tracks: [] }),
  normalizeQuery: jest.fn(q => q),
  getArtistDetails: jest.fn().mockResolvedValue(null),
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
jest.mock('../../src/services/lastfm', () => ({
  getStatus: jest.fn().mockResolvedValue({ authenticated: false }),
}));
jest.mock('../../src/services/realdebrid', () => ({}));
jest.mock('../../src/services/migrate', () => ({ migrate: jest.fn() }));
jest.mock('../../src/services/scrobble-sync', () => ({
  startDeltaSyncScheduler: jest.fn(),
  getSyncStatus: jest.fn().mockReturnValue({ state: 'not_started' }),
}));
jest.mock('../../src/services/dlna', () => ({ startDiscovery: jest.fn(), getDevices: jest.fn().mockReturnValue([]) }));

const request = require('supertest');
// Load app after env vars and mocks are set
const app = require('../../src/index');
const db = require('../../src/services/db');
// Require job-queue to ensure the jobs table schema is initialised
require('../../src/services/job-queue');
const fs = require('fs');

// Auth header to identify as 'nathan' (seeded user)
function nathanHeader() {
  return { 'X-User-Id': 'nathan' };
}

afterAll(() => {
  db.close();
  // Cleanup temp dirs
  try { fs.rmSync(TEST_CONFIG_DIR, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(TEST_MUSIC_DIR, { recursive: true, force: true }); } catch {}
});

beforeEach(() => {
  // Clear any jobs and scrobbles between tests
  const rawDb = db.getDb();
  rawDb.exec("DELETE FROM jobs");
  rawDb.exec("DELETE FROM scrobbles");
  rawDb.exec("DELETE FROM user_settings WHERE key = 'scrobbleSync'");
});

describe('POST /api/import/lastfm', () => {
  test('returns 400 when scrobble sync not complete', async () => {
    // No scrobbleSync setting set — defaults to null → not complete
    const res = await request(app)
      .post('/api/import/lastfm')
      .set(nathanHeader())
      .send({ days: 60 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not complete/i);
  });

  test('returns summary with found=0 and queued=0 when scrobbles empty', async () => {
    db.setUserSetting('nathan', 'scrobbleSync', { state: 'complete', lastSyncedAt: Math.floor(Date.now() / 1000) });

    const res = await request(app)
      .post('/api/import/lastfm')
      .set(nathanHeader())
      .send({ days: 60 });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(0);
    expect(res.body.queued).toBe(0);
    expect(res.body.alreadyInLibrary).toBe(0);
  });

  test('queues albums not in library', async () => {
    db.setUserSetting('nathan', 'scrobbleSync', { state: 'complete', lastSyncedAt: Math.floor(Date.now() / 1000) });

    const now = Math.floor(Date.now() / 1000);
    db.insertScrobbles('nathan', [
      { artist: 'NewArtist', album: 'NewAlbum', track: 'Track1', played_at: now - 100 },
      { artist: 'NewArtist', album: 'NewAlbum', track: 'Track2', played_at: now - 200 },
    ]);

    const res = await request(app)
      .post('/api/import/lastfm')
      .set(nathanHeader())
      .send({ days: 60 });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(1);   // 1 unique album
    expect(res.body.queued).toBe(1);
    expect(res.body.alreadyInLibrary).toBe(0);
  });

  test('counts alreadyInLibrary when album dir with audio exists', async () => {
    db.setUserSetting('nathan', 'scrobbleSync', { state: 'complete', lastSyncedAt: Math.floor(Date.now() / 1000) });

    const now = Math.floor(Date.now() / 1000);
    db.insertScrobbles('nathan', [
      { artist: 'TestArtist', album: 'TestAlbum', track: 'T1', played_at: now - 10 },
    ]);

    // Create a fake album dir with an audio file
    const albumDir = path.join(TEST_MUSIC_DIR, 'TestArtist', 'TestAlbum');
    fs.mkdirSync(albumDir, { recursive: true });
    fs.writeFileSync(path.join(albumDir, 'track.flac'), 'fake audio');

    const res = await request(app)
      .post('/api/import/lastfm')
      .set(nathanHeader())
      .send({ days: 60 });

    expect(res.status).toBe(200);
    expect(res.body.alreadyInLibrary).toBe(1);
    expect(res.body.queued).toBe(0);

    // Cleanup
    fs.rmSync(path.join(TEST_MUSIC_DIR, 'TestArtist'), { recursive: true, force: true });
  });

  test('counts alreadyQueued for duplicate pending jobs', async () => {
    db.setUserSetting('nathan', 'scrobbleSync', { state: 'complete', lastSyncedAt: Math.floor(Date.now() / 1000) });

    const now = Math.floor(Date.now() / 1000);
    db.insertScrobbles('nathan', [
      { artist: 'SomeArtist', album: 'SomeAlbum', track: 'T1', played_at: now - 10 },
    ]);

    // Pre-enqueue the same album
    const jobQueue = require('../../src/services/job-queue');
    const { normalize } = require('../../src/services/library-check');
    const dedupeKey = normalize('SomeArtist') + ':' + normalize('SomeAlbum');
    jobQueue.enqueue('download', { artist: 'SomeArtist', album: 'SomeAlbum' }, { dedupeKey });

    const res = await request(app)
      .post('/api/import/lastfm')
      .set(nathanHeader())
      .send({ days: 60 });

    expect(res.status).toBe(200);
    expect(res.body.alreadyQueued).toBe(1);
    expect(res.body.queued).toBe(0);
  });

  test('respects the days parameter (excludes old scrobbles)', async () => {
    db.setUserSetting('nathan', 'scrobbleSync', { state: 'complete', lastSyncedAt: Math.floor(Date.now() / 1000) });

    const now = Math.floor(Date.now() / 1000);
    // played 120 days ago — should be excluded when days=60
    db.insertScrobbles('nathan', [
      { artist: 'OldArtist', album: 'OldAlbum', track: 'T1', played_at: now - (120 * 86400) },
    ]);

    const res = await request(app)
      .post('/api/import/lastfm')
      .set(nathanHeader())
      .send({ days: 60 });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(0);
  });

  test('returns artists count', async () => {
    db.setUserSetting('nathan', 'scrobbleSync', { state: 'complete', lastSyncedAt: Math.floor(Date.now() / 1000) });

    const now = Math.floor(Date.now() / 1000);
    db.insertScrobbles('nathan', [
      { artist: 'Artist1', album: 'Album1', track: 'T1', played_at: now - 10 },
      { artist: 'Artist2', album: 'Album2', track: 'T2', played_at: now - 20 },
    ]);

    const res = await request(app)
      .post('/api/import/lastfm')
      .set(nathanHeader())
      .send({ days: 60 });

    expect(res.status).toBe(200);
    expect(res.body.artists).toBe(2);
    expect(res.body.found).toBe(2);
  });
});
