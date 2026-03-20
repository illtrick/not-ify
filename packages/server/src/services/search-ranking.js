const QUALITY_SCORES = { flac: 1.0, '320': 0.8, v0: 0.7, '256': 0.5, mp3: 0.3, unknown: 0.1 };
const MAX_BOOST = 0.3;
const WEIGHT = 0.1;
const HALF_LIFE_DAYS = 90;
const MIN_PLAYS = 2;
// Scale factor applied when ranking: allows personal affinity to overcome quality/source gaps
const RANK_BOOST_SCALE = 5;

function computeRelevanceScore({ textMatch = 0, quality = 'unknown', seeders = 0, maxSeeders = 1 }) {
  const sourceScore = QUALITY_SCORES[quality] || 0.1;
  const popularity = maxSeeders > 0 ? Math.log(1 + seeders) / Math.log(1 + maxSeeders) : 0;
  return (textMatch * 0.5) + (sourceScore * 0.3) + (popularity * 0.2);
}

function computePersonalBoost(affinity) {
  if (!affinity || affinity.play_count < MIN_PLAYS) return 0;
  const daysSince = (Date.now() / 1000 - affinity.last_played_at) / 86400;
  const decay = 1 / (1 + daysSince / HALF_LIFE_DAYS);
  return Math.min(MAX_BOOST, WEIGHT * Math.log2(1 + affinity.play_count) * decay);
}

function rankResults(results, affinityMap) {
  const maxSeeders = Math.max(1, ...results.map(r => r.bestSeeders || 0));
  return results.map(r => {
    const relevance = computeRelevanceScore({
      textMatch: r.matchScore || 0.5,
      quality: r.bestQuality || 'unknown',
      seeders: r.bestSeeders || 0,
      maxSeeders,
    });
    const affinity = affinityMap.get((r.artist || '').toLowerCase());
    const boost = computePersonalBoost(affinity);
    return { ...r, _relevance: relevance, _boost: boost, _finalScore: relevance * (1 + boost * RANK_BOOST_SCALE) };
  }).sort((a, b) => b._finalScore - a._finalScore);
}

function getHistoryInjections(db, userId, query, existingArtistNames) {
  if (!userId) return [];
  const matches = db.searchArtistAffinity(userId, query);
  const existingSet = new Set(existingArtistNames.map(a => (a || '').toLowerCase()));
  return matches
    .filter(m => !existingSet.has(m.artist.toLowerCase()))
    .slice(0, 3)
    .map(m => ({
      artist: m.artist,
      album: null,
      sources: [],
      matchScore: 0.6,
    }));
}

module.exports = { computeRelevanceScore, computePersonalBoost, rankResults, getHistoryInjections };
