const os = require('os');
const path = require('path');

let db;

beforeEach(() => {
  // Use a unique DB per test to avoid data bleed
  process.env.CONFIG_DIR = path.join(os.tmpdir(), `notify-test-${process.pid}-${Date.now()}`);
  jest.resetModules();
  db = require('../../src/services/db');
});

afterEach(() => db.close());

describe('scrobble database', () => {
  test('insertScrobbles bulk inserts and deduplicates', () => {
    db.insertScrobbles('nathan', [
      { artist: 'Heilung', album: 'Ofnir', track: 'Alfadhirhaiti', played_at: 1000 },
      { artist: 'Heilung', album: 'Ofnir', track: 'Alfadhirhaiti', played_at: 1000 }, // duplicate
    ]);
    expect(db.getScrobbleCount('nathan')).toBe(1);
  });

  test('rebuildArtistAffinity aggregates play counts and last_played_at', () => {
    db.insertScrobbles('nathan', [
      { artist: 'Heilung', album: 'Ofnir', track: 'Track1', played_at: 1000 },
      { artist: 'Heilung', album: 'Ofnir', track: 'Track2', played_at: 2000 },
      { artist: 'Wardruna', album: 'Runaljod', track: 'Track1', played_at: 3000 },
    ]);
    db.rebuildArtistAffinity('nathan');
    const affinity = db.getArtistAffinity('nathan');
    expect(affinity).toHaveLength(2);
    const heilung = affinity.find(a => a.artist === 'Heilung');
    expect(heilung.play_count).toBe(2);
    expect(heilung.last_played_at).toBe(2000);
  });

  test('getUniqueAlbumsSince returns albums within time window only', () => {
    const now = Math.floor(Date.now() / 1000);
    db.insertScrobbles('nathan', [
      { artist: 'A', album: 'Old', track: 'T', played_at: now - 200 * 86400 },
      { artist: 'B', album: 'Recent', track: 'T', played_at: now - 30 * 86400 },
    ]);
    const albums = db.getUniqueAlbumsSince('nathan', 60);
    expect(albums).toHaveLength(1);
    expect(albums[0].artist).toBe('B');
  });

  test('searchArtistAffinity finds prefix/substring matches', () => {
    db.insertScrobbles('nathan', [
      { artist: 'Heilung', album: 'Ofnir', track: 'T1', played_at: 1000 },
      { artist: 'Heilung', album: 'Ofnir', track: 'T2', played_at: 2000 },
    ]);
    db.rebuildArtistAffinity('nathan');
    const matches = db.searchArtistAffinity('nathan', 'heil');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].artist).toBe('Heilung');
  });

  test('searchArtistAffinity requires minimum 2 plays', () => {
    db.insertScrobbles('nathan', [
      { artist: 'OnePlay', album: 'X', track: 'T', played_at: 1000 },
    ]);
    db.rebuildArtistAffinity('nathan');
    const matches = db.searchArtistAffinity('nathan', 'oneplay');
    expect(matches).toHaveLength(0);
  });
});
