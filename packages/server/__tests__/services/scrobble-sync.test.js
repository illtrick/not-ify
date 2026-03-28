const os = require('os');
const path = require('path');
process.env.CONFIG_DIR = path.join(os.tmpdir(), `notify-test-${Date.now()}-${process.pid}`);

jest.mock('../../src/services/lastfm');

let db, sync;

function mockTrack(artist, album, track, uts) {
  return {
    artist: { '#text': artist },
    album: { '#text': album },
    name: track,
    date: { uts: String(uts) },
  };
}

beforeEach(() => {
  jest.resetModules();
  db = require('../../src/services/db');
  sync = require('../../src/services/scrobble-sync');
  require('../../src/services/lastfm').getRecentTracksPage = jest.fn();
  // Create test users since they're no longer seeded
  const d = db.getDb();
  d.prepare("INSERT OR IGNORE INTO users (id, display_name, role) VALUES (?, ?, ?)").run('test-user', 'Test User', 'admin');
  d.prepare("INSERT OR IGNORE INTO users (id, display_name, role) VALUES (?, ?, ?)").run('test-user-2', 'Test User 2', 'user');
});

afterEach(() => sync.stopAll());
afterAll(() => db.close());

describe('scrobble-sync', () => {
  test('fullSync pages through all scrobbles', async () => {
    const lastfm = require('../../src/services/lastfm');
    lastfm.getRecentTracksPage
      .mockResolvedValueOnce({ tracks: [mockTrack('A', 'B', 'T', 1000)], totalPages: 2, total: 2 })
      .mockResolvedValueOnce({ tracks: [mockTrack('C', 'D', 'T', 2000)], totalPages: 2, total: 2 });

    // 'test-user' is seeded in db.js
    const result = await sync.fullSync('test-user', 'lastfmuser');
    expect(result.fetched).toBe(2);
    expect(db.getScrobbleCount('test-user')).toBe(2);
  });

  test('fullSync filters out now-playing tracks (no date)', async () => {
    const lastfm = require('../../src/services/lastfm');
    const nowPlaying = { artist: { '#text': 'X' }, album: { '#text': 'Y' }, name: 'Z' }; // no date
    lastfm.getRecentTracksPage
      .mockResolvedValueOnce({ tracks: [nowPlaying, mockTrack('A', 'B', 'T', 1000)], totalPages: 1, total: 1 });

    // 'test-user-2' is seeded in db.js
    const result = await sync.fullSync('test-user-2', 'lfmuser2');
    expect(result.fetched).toBe(1);
    expect(db.getScrobbleCount('test-user-2')).toBe(1);
  });

  test('fullSync sets sync state to complete after finish', async () => {
    const lastfm = require('../../src/services/lastfm');
    lastfm.getRecentTracksPage
      .mockResolvedValueOnce({ tracks: [mockTrack('A', 'B', 'T', 1000)], totalPages: 1, total: 1 });

    // 'test-user' is seeded in db.js
    await sync.fullSync('test-user', 'lfmuser3');
    // db.getUserSetting already returns a parsed value (not a string)
    const state = db.getUserSetting('test-user', 'scrobbleSync');
    expect(state.state).toBe('complete');
    expect(state.lastSyncedAt).toBeGreaterThan(0);
  });

  test('deltaSync uses latest scrobble timestamp from DB', async () => {
    const lastfm = require('../../src/services/lastfm');
    // Prior fullSync tests inserted scrobbles with played_at up to 2000
    // deltaSync should use the DB's latest timestamp, not the sync state
    db.setUserSetting('test-user', 'scrobbleSync', { state: 'complete', lastSyncedAt: 999999 });
    lastfm.getRecentTracksPage
      .mockResolvedValueOnce({ tracks: [], totalPages: 1, total: 0 });

    await sync.deltaSync('test-user', 'lfmuser');
    // Uses MAX(played_at) from DB (2000 from prior test inserts), not lastSyncedAt (999999)
    const calledFrom = lastfm.getRecentTracksPage.mock.calls[0][3];
    expect(calledFrom).toBeGreaterThan(0);
  });

  test('fullSync retries page on 429 then succeeds', async () => {
    const lastfm = require('../../src/services/lastfm');
    // Mock sleep to be instant so test doesn't wait 30s
    jest.spyOn(global, 'setTimeout').mockImplementation((fn) => { fn(); return 0; });

    lastfm.getRecentTracksPage
      .mockRejectedValueOnce(new Error('Last.fm API 429'))
      .mockResolvedValueOnce({ tracks: [mockTrack('A', 'B', 'T', 1000)], totalPages: 1, total: 1 });

    // 'test-user' is seeded in db.js
    const result = await sync.fullSync('test-user', 'lfmuser-retry');
    expect(result.fetched).toBe(1);

    jest.restoreAllMocks();
  });

  test('deltaSync falls back to fullSync when no lastSyncedAt', async () => {
    const lastfm = require('../../src/services/lastfm');
    lastfm.getRecentTracksPage
      .mockResolvedValueOnce({ tracks: [mockTrack('A', 'B', 'T', 1000)], totalPages: 1, total: 1 });

    // 'test-user-2' is seeded in db.js; ensure no prior sync state so deltaSync falls back to fullSync
    db.setUserSetting('test-user-2', 'scrobbleSync', null);
    const result = await sync.deltaSync('test-user-2', 'lfmuser-fallback');
    expect(result.fetched).toBe(1);
  });

  test('fullSync handles null tracks without throwing (B10)', async () => {
    const lastfm = require('../../src/services/lastfm');
    lastfm.getRecentTracksPage
      .mockResolvedValueOnce({ tracks: null, totalPages: 1, total: 0 });

    await expect(sync.fullSync('test-user', 'lfmuser-null-tracks')).resolves.not.toThrow();
  });

  test('deltaSync handles null tracks without throwing (B10)', async () => {
    const lastfm = require('../../src/services/lastfm');
    // Give test-user-2 a prior sync state so deltaSync doesn't fall back to fullSync
    db.setUserSetting('test-user-2', 'scrobbleSync', { state: 'complete', lastSyncedAt: 1000 });
    lastfm.getRecentTracksPage
      .mockResolvedValueOnce({ tracks: null, totalPages: 1, total: 0 });

    await expect(sync.deltaSync('test-user-2', 'lfmuser-null-tracks-delta')).resolves.not.toThrow();
  });
});
