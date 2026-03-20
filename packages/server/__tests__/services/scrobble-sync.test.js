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
});

afterEach(() => sync.stopAll());
afterAll(() => db.close());

describe('scrobble-sync', () => {
  test('fullSync pages through all scrobbles', async () => {
    const lastfm = require('../../src/services/lastfm');
    lastfm.getRecentTracksPage
      .mockResolvedValueOnce({ tracks: [mockTrack('A', 'B', 'T', 1000)], totalPages: 2, total: 2 })
      .mockResolvedValueOnce({ tracks: [mockTrack('C', 'D', 'T', 2000)], totalPages: 2, total: 2 });

    // 'nathan' is seeded in db.js
    const result = await sync.fullSync('nathan', 'lastfmuser');
    expect(result.fetched).toBe(2);
    expect(db.getScrobbleCount('nathan')).toBe(2);
  });

  test('fullSync filters out now-playing tracks (no date)', async () => {
    const lastfm = require('../../src/services/lastfm');
    const nowPlaying = { artist: { '#text': 'X' }, album: { '#text': 'Y' }, name: 'Z' }; // no date
    lastfm.getRecentTracksPage
      .mockResolvedValueOnce({ tracks: [nowPlaying, mockTrack('A', 'B', 'T', 1000)], totalPages: 1, total: 1 });

    // 'sarah' is seeded in db.js
    const result = await sync.fullSync('sarah', 'lfmuser2');
    expect(result.fetched).toBe(1);
    expect(db.getScrobbleCount('sarah')).toBe(1);
  });

  test('fullSync sets sync state to complete after finish', async () => {
    const lastfm = require('../../src/services/lastfm');
    lastfm.getRecentTracksPage
      .mockResolvedValueOnce({ tracks: [mockTrack('A', 'B', 'T', 1000)], totalPages: 1, total: 1 });

    // 'nathan' is seeded in db.js
    await sync.fullSync('nathan', 'lfmuser3');
    // db.getUserSetting already returns a parsed value (not a string)
    const state = db.getUserSetting('nathan', 'scrobbleSync');
    expect(state.state).toBe('complete');
    expect(state.lastSyncedAt).toBeGreaterThan(0);
  });

  test('deltaSync passes from timestamp to API', async () => {
    const lastfm = require('../../src/services/lastfm');
    // Set up a previous sync state — db.setUserSetting stringifies internally, so pass plain object
    db.setUserSetting('nathan', 'scrobbleSync', { state: 'complete', lastSyncedAt: 999999 });
    lastfm.getRecentTracksPage
      .mockResolvedValueOnce({ tracks: [], totalPages: 1, total: 0 });

    await sync.deltaSync('nathan', 'lfmuser');
    expect(lastfm.getRecentTracksPage).toHaveBeenCalledWith('lfmuser', 1, 200, 999999);
  });

  test('fullSync retries page on 429 then succeeds', async () => {
    const lastfm = require('../../src/services/lastfm');
    // Mock sleep to be instant so test doesn't wait 30s
    jest.spyOn(global, 'setTimeout').mockImplementation((fn) => { fn(); return 0; });

    lastfm.getRecentTracksPage
      .mockRejectedValueOnce(new Error('Last.fm API 429'))
      .mockResolvedValueOnce({ tracks: [mockTrack('A', 'B', 'T', 1000)], totalPages: 1, total: 1 });

    // 'nathan' is seeded in db.js
    const result = await sync.fullSync('nathan', 'lfmuser-retry');
    expect(result.fetched).toBe(1);

    jest.restoreAllMocks();
  });

  test('deltaSync falls back to fullSync when no lastSyncedAt', async () => {
    const lastfm = require('../../src/services/lastfm');
    lastfm.getRecentTracksPage
      .mockResolvedValueOnce({ tracks: [mockTrack('A', 'B', 'T', 1000)], totalPages: 1, total: 1 });

    // 'sarah' is seeded in db.js; ensure no prior sync state so deltaSync falls back to fullSync
    db.setUserSetting('sarah', 'scrobbleSync', null);
    const result = await sync.deltaSync('sarah', 'lfmuser-fallback');
    expect(result.fetched).toBe(1);
  });
});
