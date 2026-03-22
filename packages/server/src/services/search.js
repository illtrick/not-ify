const { getProxyFetch, recordFailure } = require('./proxy');
const { cleanSearchQuery, foldDiacritics } = require('./query-utils');
const { searchSoulseekCascade, checkHealth: slskHealth } = require('./soulseek');

const APIBAY_BASE = 'https://apibay.org';

const torrentCache = new Map();
const TORRENT_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

async function searchMusic(query) {
  const cacheKey = query.toLowerCase().trim();
  const cached = torrentCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  try {
    const url = `${APIBAY_BASE}/q.php?q=${encodeURIComponent(query)}&cat=100`;
    const proxyFetch = getProxyFetch();
    const res = await proxyFetch(url, { signal: AbortSignal.timeout(10000) });

    if (!res.ok) {
      console.error(`ApiBay returned ${res.status}`);
      return [];
    }

    const data = await res.json();

    // ApiBay returns [{"id":"0","name":"No results..."}] when no results
    if (!Array.isArray(data) || data.length === 0) return [];
    if (data.length === 1 && data[0].id === '0') return [];

    const results = data
      .filter(item => parseInt(item.seeders, 10) > 0)
      .map(item => ({
        id: `apibay_${item.id}`,
        name: item.name,
        magnetLink: `magnet:?xt=urn:btih:${item.info_hash}&dn=${encodeURIComponent(item.name)}`,
        seeders: parseInt(item.seeders, 10),
        leechers: parseInt(item.leechers, 10),
        size: parseInt(item.size, 10),
        sizeFormatted: formatBytes(parseInt(item.size, 10)),
        source: 'apibay',
      }))
      .sort((a, b) => b.seeders - a.seeders);

    torrentCache.set(cacheKey, { data: results, expires: Date.now() + TORRENT_CACHE_TTL });
    return results;
  } catch (err) {
    console.error(`Search failed: ${err.message}`);
    recordFailure('apibay', err.message);
    return [];
  }
}

const llm = require('./llm');

const SEARCH_QUERY_SCHEMA = {
  type: 'object',
  properties: {
    queries: { type: 'array', items: { type: 'string' } },
  },
  required: ['queries'],
};

/**
 * Generate multiple search queries for a target album using LLM.
 * Falls back to programmatic queries when LLM unavailable.
 */
async function generateSearchQueries(artist, album, targetQuality = 'flac') {
  const fallback = [];
  const cleaned = cleanSearchQuery(album);
  const searchAlbum = cleaned || album;

  // 1. Standard: artist + cleaned album + quality
  fallback.push(`${artist} ${searchAlbum} ${targetQuality}`);

  // 2. Discography query
  fallback.push(`${artist} discography ${targetQuality}`);

  // 3. No quality filter (catches mixed-format torrents)
  fallback.push(`${artist} ${searchAlbum}`);

  // 4. Short query (first 3-4 significant words, for long album names)
  const words = `${artist} ${searchAlbum}`.split(/\s+/).filter(w => w.length > 1);
  if (words.length > 4) {
    fallback.push(words.slice(0, 4).join(' ') + ' ' + targetQuality);
  }

  // 5. Diacritic-folded version (for ø, ä, ł etc.)
  const folded = foldDiacritics(`${artist} ${searchAlbum} ${targetQuality}`);
  if (folded !== fallback[0]) {
    fallback.push(folded);
  }

  try {
    const healthy = await llm.checkHealth();
    if (!healthy) return fallback;

    const result = await llm.prompt(
      `Generate 3-5 torrent search queries to find this music album in ${targetQuality} quality.\n` +
      `Artist: ${artist}\nAlbum: ${album}\n\n` +
      `Rules:\n` +
      `- Include the standard query: "artist album ${targetQuality}"\n` +
      `- Include a discography query: "artist discography ${targetQuality}" or "artist complete lossless"\n` +
      `- Include abbreviated or alternate name forms if the artist/album has common shortenings\n` +
      `- Include a year-tagged variant if you know the release year\n` +
      `- Each query should be a plain search string, no operators\n` +
      `- Return ONLY the queries array, no explanations`,
      SEARCH_QUERY_SCHEMA
    );

    if (result?.queries?.length > 0) {
      // Ensure fallback queries are always included
      const set = new Set(result.queries.map(q => q.toLowerCase().trim()));
      for (const f of fallback) {
        if (!set.has(f.toLowerCase())) result.queries.push(f);
      }
      return result.queries;
    }
  } catch {
    // LLM failed, use fallback
  }

  return fallback;
}

// Quality tokens to detect in torrent names, ranked by quality level
// Aligned with QUALITY_RANK in library-check.js
const QUALITY_TOKENS = {
  '24bit': 7, '24-bit': 7,
  flac: 6, lossless: 6,
  '320': 5, '320kbps': 5,
  v0: 4,
  '256': 3, '256kbps': 3,
  mp3: 2, // generic mp3 — at least 128+
};

// Map from library-check quality names to ranks (same as QUALITY_RANK)
const CURRENT_QUALITY_RANK = { flac: 6, '320': 5, v0: 4, '256': 3, '192': 2, '128': 1, unknown: 0 };

/**
 * Detect the quality level advertised in a torrent/result name.
 * Returns the quality key (e.g. 'flac', '320', 'mp3') or null.
 */
function detectQualityFromName(name) {
  const lower = name.toLowerCase();
  let bestToken = null;
  let bestRank = 0;
  for (const [token, rank] of Object.entries(QUALITY_TOKENS)) {
    const tokenRegex = new RegExp(`\\b${token}\\b`, 'i');
    if (tokenRegex.test(lower) && rank > bestRank) {
      bestRank = rank;
      bestToken = token;
    }
  }
  // Normalize to library-check quality names
  if (!bestToken) return null;
  if (['24bit', '24-bit'].includes(bestToken)) return 'flac';
  if (['flac', 'lossless'].includes(bestToken)) return 'flac';
  if (['320', '320kbps'].includes(bestToken)) return '320';
  if (bestToken === 'v0') return 'v0';
  if (['256', '256kbps'].includes(bestToken)) return '256';
  return 'unknown';
}

/**
 * Score a torrent result against the target artist/album.
 * Quality scoring rewards any source better than currentQuality.
 * Returns 0.0 (no match) to 1.0 (perfect match).
 */
function scoreResult(torrentName, artist, album, currentQuality, seeders, maxSeeders) {
  const lower = torrentName.toLowerCase();
  const artistTokens = artist.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  const albumTokens = album.toLowerCase().split(/\s+/).filter(t => t.length > 1);

  // Artist match (0.35)
  const artistHits = artistTokens.filter(t => lower.includes(t)).length;
  const artistScore = artistTokens.length > 0 ? artistHits / artistTokens.length : 0;

  // Album match (0.35) — discography counts as partial match
  const isDiscography = /discograph|complete|anthology|collection/i.test(lower);
  let albumScore;
  if (isDiscography) {
    albumScore = 0.5; // partial credit for discographies
  } else {
    const albumHits = albumTokens.filter(t => lower.includes(t)).length;
    albumScore = albumTokens.length > 0 ? albumHits / albumTokens.length : 0;
  }

  // Quality match (0.15) — reward anything better than current quality
  let qualityScore = 0;
  const currentRank = CURRENT_QUALITY_RANK[currentQuality] ?? 0;
  const detected = detectQualityFromName(lower);
  const detectedRank = CURRENT_QUALITY_RANK[detected] ?? 0;
  if (detectedRank > currentRank) {
    // Better quality than what we have — full credit
    qualityScore = 1.0;
  } else if (detectedRank === currentRank && detectedRank > 0) {
    // Same quality — partial credit (might still be a better rip)
    qualityScore = 0.5;
  }
  // Worse or unknown quality — 0

  // Seeders (0.15)
  const clampedSeeders = Math.max(seeders, 1);
  const clampedMax = Math.max(maxSeeders, 2);
  const seederScore = Math.log2(clampedSeeders) / Math.log2(clampedMax);

  const total = 0.35 * artistScore + 0.35 * albumScore + 0.15 * qualityScore + 0.15 * Math.min(seederScore, 1);
  return { total, artistScore, albumScore, qualityScore, seederScore: Math.min(seederScore, 1), isDiscography, detectedQuality: detected };
}

/**
 * Search for a better quality source for an album.
 * Cascading upgrade: accepts any source better than currentQuality.
 * Uses LLM query expansion when available, falls back to programmatic queries.
 *
 * @param {{ artist, album, currentQuality? }} opts
 * @returns {Promise<{ magnetLink, name, seeders, score, isDiscography, detectedQuality? } | null>}
 */
async function searchForUpgrade({ artist, album, currentQuality = 'unknown' }) {
  // Search broadly — include FLAC and format-agnostic queries
  const queries = await generateSearchQueries(artist, album, 'flac');

  // Run all queries, collect unique results by magnet info_hash
  const seen = new Set();
  const allResults = [];

  // Use require to allow Jest to intercept searchMusic in tests
  // eslint-disable-next-line import/no-self-import
  const { searchMusic: _searchMusic } = require('./search');
  const { searchSolidTorrents } = require('./solidtorrents');
  for (const query of queries) {
    try {
      const [apibayResults, solidResults] = await Promise.all([
        _searchMusic(query).catch(() => []),
        searchSolidTorrents(query).catch(() => []),
      ]);
      const results = [...apibayResults, ...solidResults];
      for (const r of results) {
        const hash = r.magnetLink?.match(/btih:([a-f0-9]+)/i)?.[1]?.toLowerCase();
        const dedupeKey = hash || r.id || r.magnetLink;
        if (dedupeKey && !seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          allResults.push(r);
        }
      }
    } catch {
      // Query failed, continue with others
    }
  }

  // Soulseek search (cascade is sequential, runs after torrent queries)
  try {
    const slskHealthy = await slskHealth();
    if (slskHealthy) {
      const slskResult = await searchSoulseekCascade(artist, album, { timeout: 15000 });
      if (slskResult.responseCount > 0) {
        const bestUser = pickBestSoulseekUser(slskResult.responses, artist, album);
        if (bestUser) {
          allResults.push({
            id: `slsk_${bestUser.username}_${Date.now()}`,
            name: `${artist} - ${album} [Soulseek: ${bestUser.username}]`,
            seeders: bestUser.hasFreeSlot ? 10 : 1, // normalize for scoring
            source: 'soulseek',
            soulseekUser: bestUser.username,
            files: bestUser.files,
            hasFreeSlot: bestUser.hasFreeSlot,
            speed: bestUser.speed,
          });
        }
      }
    }
  } catch (err) {
    console.error(`[search] Soulseek search failed: ${err.message}`);
  }

  if (allResults.length === 0) return null;

  // Score and rank — quality scoring is relative to currentQuality
  const maxSeeders = Math.max(...allResults.map(r => r.seeders || 0), 1);
  const scored = allResults.map(r => {
    const s = scoreResult(r.name, artist, album, currentQuality, r.seeders || 0, maxSeeders);
    return { ...r, score: s.total, isDiscography: s.isDiscography, detectedQuality: s.detectedQuality, scoring: s };
  });

  // Filter below threshold, sort descending
  const viable = scored.filter(r => r.score >= 0.3).sort((a, b) => b.score - a.score);
  if (viable.length === 0) return null;

  const best = viable[0];

  if (best.source === 'soulseek') {
    return {
      source: 'soulseek',
      name: best.name,
      score: best.score,
      detectedQuality: best.detectedQuality || 'flac',
      soulseekUser: best.soulseekUser,
      files: best.files,
      hasFreeSlot: best.hasFreeSlot,
      isDiscography: false,
    };
  }

  return {
    magnetLink: best.magnetLink,
    name: best.name,
    seeders: best.seeders,
    score: best.score,
    detectedQuality: best.detectedQuality || 'unknown',
    isDiscography: best.isDiscography,
    sources: [{ name: best.name, seeders: best.seeders, source: best.source }],
  };
}

/**
 * Pick the best Soulseek user from search results.
 * Filters for users with enough FLAC files to be a full album,
 * prefers free upload slots and higher speeds.
 */
function pickBestSoulseekUser(responses, artist, album) {
  const candidates = responses
    .map(r => {
      // Group files by directory
      const dirs = new Map();
      for (const f of r.files) {
        const parts = f.filename.split(/[\\/]/);
        const dir = parts.slice(0, -1).join('/');
        if (!dirs.has(dir)) dirs.set(dir, []);
        dirs.get(dir).push(f);
      }
      // Find best directory: prefer dirs whose path contains the album name,
      // then pick the one with the most audio files (capped at 30 to avoid
      // grabbing entire discographies).
      const normAlbum = album.toLowerCase().replace(/[^a-z0-9]/g, '');
      let bestDir = null;
      let bestDirFiles = [];
      let bestDirMatchesAlbum = false;
      for (const [dir, files] of dirs) {
        const audioFiles = files.filter(f => /\.(flac|mp3|wav|ogg|m4a|aac|alac|wma|opus|ape|wv)$/i.test(f.filename));
        if (audioFiles.length < 3 || audioFiles.length > 30) continue; // skip tiny or discography-sized dirs
        const normDir = dir.toLowerCase().replace(/[^a-z0-9]/g, '');
        const dirMatchesAlbum = normDir.includes(normAlbum);
        // Prefer album-matching dirs; among same-match level, prefer more files
        if (dirMatchesAlbum && !bestDirMatchesAlbum) {
          bestDir = dir; bestDirFiles = audioFiles; bestDirMatchesAlbum = true;
        } else if (dirMatchesAlbum === bestDirMatchesAlbum && audioFiles.length > bestDirFiles.length) {
          bestDir = dir; bestDirFiles = audioFiles; bestDirMatchesAlbum = dirMatchesAlbum;
        }
      }
      const flacCount = bestDirFiles.filter(f => /\.flac$/i.test(f.filename)).length;
      return {
        username: r.username,
        hasFreeSlot: r.hasFreeSlot,
        speed: r.speed || 0,
        files: bestDirFiles,
        flacCount,
        totalFiles: bestDirFiles.length,
      };
    })
    .filter(c => c.totalFiles >= 3); // need at least 3 audio files to be a plausible album

  if (candidates.length === 0) return null;

  // Sort: prefer FLAC, free slots, high speed
  candidates.sort((a, b) => {
    if (b.flacCount !== a.flacCount) return b.flacCount - a.flacCount;
    if (a.hasFreeSlot !== b.hasFreeSlot) return a.hasFreeSlot ? -1 : 1;
    return b.speed - a.speed;
  });

  return candidates[0];
}

module.exports = { searchMusic, generateSearchQueries, searchForUpgrade, scoreResult };
