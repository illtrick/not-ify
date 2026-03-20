const now = Math.floor(Date.now() / 1000);

describe('search-ranking', () => {
  let ranking;
  beforeEach(() => {
    jest.resetModules();
    ranking = require('../../src/services/search-ranking');
  });

  test('computeRelevanceScore combines text, source, popularity', () => {
    const { computeRelevanceScore } = ranking;
    const score = computeRelevanceScore({ textMatch: 0.9, quality: 'flac', seeders: 50, maxSeeders: 100 });
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  test('computePersonalBoost returns 0 for null affinity', () => {
    expect(ranking.computePersonalBoost(null)).toBe(0);
  });

  test('computePersonalBoost caps at 0.3', () => {
    const boost = ranking.computePersonalBoost({ play_count: 100000, last_played_at: now });
    expect(boost).toBe(0.3);
  });

  test('computePersonalBoost returns 0 for play_count < 2', () => {
    expect(ranking.computePersonalBoost({ play_count: 1, last_played_at: now })).toBe(0);
  });

  test('computePersonalBoost decays over 90 days', () => {
    const recent = ranking.computePersonalBoost({ play_count: 10, last_played_at: now });
    const old = ranking.computePersonalBoost({ play_count: 10, last_played_at: now - 90 * 86400 });
    expect(recent).toBeGreaterThan(old);
  });

  test('rankResults sorts by finalScore descending', () => {
    const { rankResults } = ranking;
    const results = [
      { artist: 'Low', matchScore: 0.3, bestQuality: 'unknown', bestSeeders: 1 },
      { artist: 'High', matchScore: 0.9, bestQuality: 'flac', bestSeeders: 100 },
    ];
    const ranked = rankResults(results, new Map());
    expect(ranked[0].artist).toBe('High');
  });

  test('personal boost promotes listened-to artist', () => {
    const { rankResults } = ranking;
    const results = [
      { artist: 'Unknown', matchScore: 0.8, bestQuality: 'flac', bestSeeders: 100 },
      { artist: 'Known', matchScore: 0.7, bestQuality: 'mp3', bestSeeders: 10 },
    ];
    const affinityMap = new Map([['known', { play_count: 500, last_played_at: now }]]);
    const ranked = rankResults(results, affinityMap);
    // Known artist gets boosted above Unknown despite lower raw score
    expect(ranked[0].artist).toBe('Known');
  });
});
