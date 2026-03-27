'use strict';

// Suite — POST /api/import/lastfm
// Tests the scrobble-based library import endpoint (non-blocking).
// The endpoint returns immediately with counts; background processing tested via processImportBatch.
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
// Mock ytQueueAlbum so import tests don't make real YT requests
const mockYtQueueAlbum = jest.fn().mockResolvedValue({ queued: 0, failed: 0, total: 0 });
jest.mock('../../src/api/youtube', () => {
  const express = require('express');
  const r = express.Router();
  return { router: r, ytQueueAlbum: mockYtQueueAlbum };
});
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
  deltaSync: jest.fn().mockResolvedValue({ fetched: 0 }),
  getSyncStatus: jest.fn().mockReturnValue({ state: 'not_started' }),
}));
jest.mock('../../src/services/activity-log', () => ({
  log: jest.fn(),
  getEntries: jest.fn().mockReturnValue([]),
  onEntry: jest.fn().mockReturnValue(() => {}),
  clear: jest.fn(),
  getStatus: jest.fn().mockReturnValue({ entryCount: 0 }),
}));
jest.mock('../../src/services/dlna', () => ({ startDiscovery: jest.fn(), getDevices: jest.fn().mockReturnValue([]) }));

const request = require('supertest');
// Load app after env vars and mocks are set
const app = require('../../src/index');
const db = require('../../src/services/db');
// Require job-queue to ensure the jobs table schema is initialised
require('../../src/services/job-queue');
const fs = require('fs');

// Get processImportBatch for direct testing of background logic
const importRouter = require('../../src/api/import');
const processImportBatch = importRouter._processImportBatch;

// Auth header to identify as 'test-user' (seeded user)
function testUserHeader() {
  return { 'X-User-Id': 'test-user' };
}

afterAll(() => {
  db.close();
  // Cleanup temp dirs
  try { fs.rmSync(TEST_CONFIG_DIR, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(TEST_MUSIC_DIR, { recursive: true, force: true }); } catch {}
});

beforeAll(() => {
  // Create test users since they're no longer seeded
  const rawDb = db.getDb();
  rawDb.prepare("INSERT OR IGNORE INTO users (id, display_name, role) VALUES (?, ?, ?)").run('test-user', 'Test User', 'admin');
  rawDb.prepare("INSERT OR IGNORE INTO users (id, display_name) VALUES (?, ?)").run('default', 'Default');
});

beforeEach(() => {
  // Clear any jobs and scrobbles between tests
  const rawDb = db.getDb();
  rawDb.exec("DELETE FROM jobs");
  rawDb.exec("DELETE FROM scrobbles");
  rawDb.exec("DELETE FROM user_settings WHERE key = 'scrobbleSync'");
  mockYtQueueAlbum.mockClear();
});

describe('POST /api/import/lastfm (non-blocking)', () => {
  test('returns 400 when scrobble sync not complete', async () => {
    const res = await request(app)
      .post('/api/import/lastfm')
      .set(testUserHeader())
      .send({ days: 60 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not complete/i);
  });

  test('returns summary with found=0 and toProcess=0 when scrobbles empty', async () => {
    db.setUserSetting('test-user', 'scrobbleSync', { state: 'complete', lastSyncedAt: Math.floor(Date.now() / 1000) });

    const res = await request(app)
      .post('/api/import/lastfm')
      .set(testUserHeader())
      .send({ days: 60 });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(0);
    expect(res.body.toProcess).toBe(0);
    expect(res.body.alreadyInLibrary).toBe(0);
    expect(res.body.processing).toBe(true);
  });

  test('returns toProcess count for albums not in library (non-blocking)', async () => {
    db.setUserSetting('test-user', 'scrobbleSync', { state: 'complete', lastSyncedAt: Math.floor(Date.now() / 1000) });

    const now = Math.floor(Date.now() / 1000);
    db.insertScrobbles('test-user', [
      { artist: 'NewArtist', album: 'NewAlbum', track: 'Track1', played_at: now - 100 },
      { artist: 'NewArtist', album: 'NewAlbum', track: 'Track2', played_at: now - 200 },
    ]);

    const res = await request(app)
      .post('/api/import/lastfm')
      .set(testUserHeader())
      .send({ days: 60 });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(1);
    expect(res.body.toProcess).toBe(1);
    expect(res.body.alreadyInLibrary).toBe(0);
  });

  test('counts alreadyInLibrary when album dir with audio exists', async () => {
    db.setUserSetting('test-user', 'scrobbleSync', { state: 'complete', lastSyncedAt: Math.floor(Date.now() / 1000) });

    const now = Math.floor(Date.now() / 1000);
    db.insertScrobbles('test-user', [
      { artist: 'TestArtist', album: 'TestAlbum', track: 'T1', played_at: now - 10 },
    ]);

    const albumDir = path.join(TEST_MUSIC_DIR, 'TestArtist', 'TestAlbum');
    fs.mkdirSync(albumDir, { recursive: true });
    fs.writeFileSync(path.join(albumDir, 'track.flac'), 'fake audio');

    const res = await request(app)
      .post('/api/import/lastfm')
      .set(testUserHeader())
      .send({ days: 60 });

    expect(res.status).toBe(200);
    expect(res.body.alreadyInLibrary).toBe(1);
    expect(res.body.toProcess).toBe(0);

    fs.rmSync(path.join(TEST_MUSIC_DIR, 'TestArtist'), { recursive: true, force: true });
  });

  test('counts alreadyQueued for duplicate pending jobs', async () => {
    db.setUserSetting('test-user', 'scrobbleSync', { state: 'complete', lastSyncedAt: Math.floor(Date.now() / 1000) });

    const now = Math.floor(Date.now() / 1000);
    db.insertScrobbles('test-user', [
      { artist: 'SomeArtist', album: 'SomeAlbum', track: 'T1', played_at: now - 10 },
    ]);

    const jobQueue = require('../../src/services/job-queue');
    const { normalize } = require('../../src/services/library-check');
    const dedupeKey = normalize('SomeArtist') + ':' + normalize('SomeAlbum');
    jobQueue.enqueue('download', { artist: 'SomeArtist', album: 'SomeAlbum' }, { dedupeKey });

    const res = await request(app)
      .post('/api/import/lastfm')
      .set(testUserHeader())
      .send({ days: 60 });

    expect(res.status).toBe(200);
    expect(res.body.alreadyQueued).toBe(1);
    expect(res.body.toProcess).toBe(0);
  });

  test('respects the days parameter (excludes old scrobbles)', async () => {
    db.setUserSetting('test-user', 'scrobbleSync', { state: 'complete', lastSyncedAt: Math.floor(Date.now() / 1000) });

    const now = Math.floor(Date.now() / 1000);
    db.insertScrobbles('test-user', [
      { artist: 'OldArtist', album: 'OldAlbum', track: 'T1', played_at: now - (120 * 86400) },
    ]);

    const res = await request(app)
      .post('/api/import/lastfm')
      .set(testUserHeader())
      .send({ days: 60 });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(0);
  });

  test('returns artists count', async () => {
    db.setUserSetting('test-user', 'scrobbleSync', { state: 'complete', lastSyncedAt: Math.floor(Date.now() / 1000) });

    const now = Math.floor(Date.now() / 1000);
    db.insertScrobbles('test-user', [
      { artist: 'Artist1', album: 'Album1', track: 'T1', played_at: now - 10 },
      { artist: 'Artist2', album: 'Album2', track: 'T2', played_at: now - 20 },
    ]);

    const res = await request(app)
      .post('/api/import/lastfm')
      .set(testUserHeader())
      .send({ days: 60 });

    expect(res.status).toBe(200);
    expect(res.body.artists).toBe(2);
    expect(res.body.found).toBe(2);
  });
});

describe('processImportBatch (background)', () => {
  test('calls ytQueueAlbum when MusicBrainz returns tracks', async () => {
    const mb = require('../../src/services/musicbrainz');
    mb.searchReleases.mockResolvedValueOnce([
      { mbid: 'mbid-123', rgid: 'rgid-456', artist: 'FreshArtist', album: 'FreshAlbum', year: 2023, trackCount: 2 },
    ]);
    mb.getReleaseGroupTracks.mockResolvedValueOnce({
      releaseMbid: 'mbid-123',
      tracks: [
        { position: 1, title: 'Track One', lengthMs: 200000 },
        { position: 2, title: 'Track Two', lengthMs: 180000 },
      ],
    });

    const { normalize } = require('../../src/services/library-check');
    const batch = [{ artist: 'FreshArtist', album: 'FreshAlbum', dedupeKey: normalize('FreshArtist') + ':' + normalize('FreshAlbum') }];

    await processImportBatch(batch);

    expect(mockYtQueueAlbum).toHaveBeenCalledTimes(1);
    expect(mockYtQueueAlbum).toHaveBeenCalledWith(expect.objectContaining({
      artist: 'FreshArtist',
      album: 'FreshAlbum',
      tracks: expect.arrayContaining([expect.objectContaining({ title: 'Track One' })]),
    }));
  });

  test('falls back to download job when MusicBrainz returns no tracks', async () => {
    const mb = require('../../src/services/musicbrainz');
    mb.searchReleases.mockResolvedValueOnce([]);

    const { normalize } = require('../../src/services/library-check');
    const batch = [{ artist: 'UnknownArtist', album: 'UnknownAlbum', dedupeKey: normalize('UnknownArtist') + ':' + normalize('UnknownAlbum') }];

    await processImportBatch(batch);

    expect(mockYtQueueAlbum).not.toHaveBeenCalled();
    const rawDb = db.getDb();
    const job = rawDb.prepare("SELECT * FROM jobs WHERE status = 'pending'").get();
    expect(job).toBeTruthy();
  });

  test('smart dedup skips albums where tracks + excluded >= expected', async () => {
    const mb = require('../../src/services/musicbrainz');
    mb.searchReleases.mockResolvedValueOnce([
      { mbid: 'mbid-abc', rgid: 'rgid-def', artist: 'CompleteArtist', album: 'CompleteAlbum' },
    ]);
    mb.getReleaseGroupTracks.mockResolvedValueOnce({
      releaseMbid: 'mbid-abc',
      tracks: [
        { position: 1, title: 'T1', lengthMs: 200000 },
        { position: 2, title: 'T2', lengthMs: 180000 },
        { position: 3, title: 'T3', lengthMs: 190000 },
      ],
    });

    // Create album dir with 2 audio files + 1 excluded track in metadata
    const albumDir = path.join(TEST_MUSIC_DIR, 'CompleteArtist', 'CompleteAlbum');
    fs.mkdirSync(albumDir, { recursive: true });
    fs.writeFileSync(path.join(albumDir, '01-t1.flac'), 'fake');
    fs.writeFileSync(path.join(albumDir, '02-t2.flac'), 'fake');
    fs.writeFileSync(path.join(albumDir, '.metadata.json'), JSON.stringify({ excluded: ['03-t3.flac'] }));

    const { normalize } = require('../../src/services/library-check');
    const batch = [{ artist: 'CompleteArtist', album: 'CompleteAlbum', dedupeKey: normalize('CompleteArtist') + ':' + normalize('CompleteAlbum') }];

    await processImportBatch(batch);

    // Should skip — album is complete (2 tracks + 1 excluded = 3 >= 3 expected)
    expect(mockYtQueueAlbum).not.toHaveBeenCalled();

    // Verify activity log recorded the skip
    const activity = require('../../src/services/activity-log');
    expect(activity.log).toHaveBeenCalledWith('import', 'info', expect.stringContaining('Skipped (complete)'));

    fs.rmSync(path.join(TEST_MUSIC_DIR, 'CompleteArtist'), { recursive: true, force: true });
  });
});
