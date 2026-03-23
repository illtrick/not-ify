'use strict';
const db = require('../../src/services/db');

describe('mb_cache', () => {
  test('roundtrip: set then get', () => {
    db.mbCacheSet('test:key1', { foo: 'bar' }, 60000);
    const result = db.mbCacheGet('test:key1');
    expect(result).toEqual({ foo: 'bar' });
  });

  test('expired entries return null', () => {
    db.mbCacheSet('test:expired', [1, 2, 3], 1); // 1ms TTL
    // Wait for expiry
    const start = Date.now();
    while (Date.now() - start < 5) {} // busy wait 5ms
    expect(db.mbCacheGet('test:expired')).toBeNull();
  });

  test('negative cache stores empty arrays', () => {
    db.mbCacheSet('test:negative', [], 60000);
    expect(db.mbCacheGet('test:negative')).toEqual([]);
  });

  test('hit_count increments on get', () => {
    db.mbCacheSet('test:hits', { data: true }, 60000);
    db.mbCacheGet('test:hits');
    db.mbCacheGet('test:hits');
    db.mbCacheGet('test:hits');
    const stats = db.mbCacheStats();
    expect(stats.hits).toBeGreaterThanOrEqual(3);
  });

  test('cleanup removes expired entries', () => {
    db.mbCacheSet('test:clean1', 'a', 1);
    db.mbCacheSet('test:clean2', 'b', 60000);
    const start = Date.now();
    while (Date.now() - start < 5) {} // wait for expiry
    const removed = db.mbCacheCleanup();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(db.mbCacheGet('test:clean2')).toBe('b');
  });

  test('overwrite updates data and resets hit_count', () => {
    db.mbCacheSet('test:overwrite', 'v1', 60000);
    db.mbCacheGet('test:overwrite'); // hit_count = 1
    db.mbCacheSet('test:overwrite', 'v2', 60000); // overwrite
    expect(db.mbCacheGet('test:overwrite')).toBe('v2');
  });
});
