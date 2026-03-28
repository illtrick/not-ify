'use strict';

const db = require('../../src/services/db');

beforeAll(() => { db.getDb(); });

describe('getAlbumByAnyId', () => {
  const testId = 'test-album-anyid-001';

  beforeAll(() => {
    db.getDb().prepare(
      'INSERT OR REPLACE INTO albums (id, title, album_artist, year, mbid, rgid) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(testId, 'Test Album', 'Test Artist', 2024, 'mbid-anyid-test', 'rgid-anyid-test');
  });

  afterAll(() => {
    db.getDb().prepare('DELETE FROM albums WHERE id = ?').run(testId);
  });

  test('resolves by direct album ID', () => {
    const result = db.getAlbumByAnyId(testId);
    expect(result).not.toBeNull();
    expect(result.title).toBe('Test Album');
  });

  test('resolves by rgid', () => {
    const result = db.getAlbumByAnyId('rgid-anyid-test');
    expect(result).not.toBeNull();
    expect(result.title).toBe('Test Album');
  });

  test('resolves by mbid', () => {
    const result = db.getAlbumByAnyId('mbid-anyid-test');
    expect(result).not.toBeNull();
    expect(result.title).toBe('Test Album');
  });

  test('returns null for unknown ID', () => {
    expect(db.getAlbumByAnyId('nonexistent')).toBeNull();
  });

  test('returns null for null/undefined input', () => {
    expect(db.getAlbumByAnyId(null)).toBeNull();
    expect(db.getAlbumByAnyId(undefined)).toBeNull();
  });
});
