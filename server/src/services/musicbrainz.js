const MB_BASE = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'Not-ify/1.0.0 (personal-use)';

// In-memory cache: key -> { data, expires }
const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Rate limiter: max 1 req/sec
let lastRequestTime = 0;

async function mbFetch(url) {
  const now = Date.now();
  const wait = 1100 - (now - lastRequestTime);
  if (wait > 0) {
    await new Promise(resolve => setTimeout(resolve, wait));
  }
  lastRequestTime = Date.now();

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    if (res.status === 503) throw new Error('MusicBrainz rate limited');
    throw new Error(`MusicBrainz error ${res.status}`);
  }
  return res.json();
}

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { cache.delete(key); return null; }
  return entry.data;
}

function cacheSet(key, data) {
  cache.set(key, { data, expires: Date.now() + CACHE_TTL });
}

// Search for release-groups (albums/EPs/singles) matching a query.
// Using release-group search avoids live recordings dominating results for artist queries.
// Returns: [{ mbid, rgid, artist, album, year, trackCount }]
async function searchReleases(query) {
  const key = `releases:${query.toLowerCase().trim()}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    // Search release-groups, excluding live bootlegs that dominate GY!BE-style artist queries
    const luceneQuery = `${query} NOT secondarytype:Live NOT secondarytype:Bootleg`;
    const url = `${MB_BASE}/release-group/?query=${encodeURIComponent(luceneQuery)}&fmt=json&limit=20&inc=releases`;
    const data = await mbFetch(url);

    const ALLOWED_PRIMARY = new Set(['Album', 'Single', 'EP', 'Compilation', 'Broadcast']);
    const releases = (data['release-groups'] || [])
      .filter(rg => ALLOWED_PRIMARY.has(rg['primary-type'] || ''))
      .map(rg => {
        // Pick the release with the most tracks as the canonical release mbid
        const sortedReleases = (rg.releases || []).slice().sort((a, b) => (b['track-count'] || 0) - (a['track-count'] || 0));
        const release = sortedReleases[0];
        return {
          mbid: release?.id || null,
          rgid: rg.id,
          artist: rg['artist-credit']?.[0]?.artist?.name || rg['artist-credit']?.[0]?.name || 'Unknown Artist',
          album: rg.title || 'Unknown Album',
          year: rg['first-release-date'] ? rg['first-release-date'].slice(0, 4) : '',
          trackCount: release?.['track-count'] || null,
        };
      });

    cacheSet(key, releases);
    return releases;
  } catch (err) {
    console.error(`MusicBrainz search failed: ${err.message}`);
    return [];
  }
}

// Search for artists — deduplicates by normalized name, returns type/disambiguation info
// Returns: [{ mbid, name, type, disambiguation, sortName }]
async function searchArtists(query) {
  const key = `artists:${query.toLowerCase().trim()}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const url = `${MB_BASE}/artist/?query=${encodeURIComponent(query)}&fmt=json&limit=10`;
    const data = await mbFetch(url);

    // Deduplicate: keep best match per normalized name
    const seen = new Map();
    for (const a of (data.artists || [])) {
      const normName = a.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!seen.has(normName) || (a.score || 0) > (seen.get(normName).score || 0)) {
        seen.set(normName, {
          mbid: a.id,
          name: a.name,
          type: a.type || null, // Person, Group, Orchestra, etc.
          disambiguation: a.disambiguation || null,
          sortName: a['sort-name'] || a.name,
          score: a.score || 0,
        });
      }
    }

    const artists = Array.from(seen.values()).slice(0, 6);
    cacheSet(key, artists);
    return artists;
  } catch (err) {
    console.error(`MusicBrainz artist search failed: ${err.message}`);
    return [];
  }
}

// Browse release-groups for a specific artist MBID (canonical discography)
// Returns: [{ mbid, rgid, artist, album, year, trackCount, primaryType }]
async function browseArtistReleases(artistMbid, artistName) {
  const key = `browse:${artistMbid}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const url = `${MB_BASE}/release-group?artist=${artistMbid}&type=album%7Cep&fmt=json&limit=25`;
    const data = await mbFetch(url);

    const releases = (data['release-groups'] || []).map(rg => {
      const sortedReleases = (rg.releases || []).slice().sort((a, b) => (b['track-count'] || 0) - (a['track-count'] || 0));
      const release = sortedReleases[0];
      return {
        mbid: release?.id || null,
        rgid: rg.id,
        artist: artistName,
        album: rg.title || 'Unknown Album',
        year: rg['first-release-date'] ? rg['first-release-date'].slice(0, 4) : '',
        trackCount: release?.['track-count'] || null,
        primaryType: rg['primary-type'] || null,
      };
    });

    cacheSet(key, releases);
    return releases;
  } catch (err) {
    console.error(`MusicBrainz browse failed: ${err.message}`);
    return [];
  }
}

// Get cover art URL for a release MBID
function getCoverArtUrl(mbid) {
  return `https://coverartarchive.org/release/${mbid}/front-250`;
}

// Get track listing for a release
// Returns: [{ position, title, lengthMs }]
async function getReleaseTracks(mbid) {
  const key = `tracks:${mbid}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const url = `${MB_BASE}/release/${mbid}?inc=recordings&fmt=json`;
  const data = await mbFetch(url);

  const tracks = [];
  for (const medium of (data.media || [])) {
    for (const track of (medium.tracks || [])) {
      tracks.push({
        position: track.position,
        title: track.title || track.recording?.title || 'Unknown',
        lengthMs: track.length || track.recording?.length || null,
      });
    }
  }

  cacheSet(key, tracks);
  return tracks;
}

// Get tracks for a release-group (resolves to best release, then gets tracks)
// Returns: { releaseMbid, tracks: [{ position, title, lengthMs }] }
async function getReleaseGroupTracks(rgid) {
  const key = `rg-tracks:${rgid}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  // Browse releases within this release-group
  const url = `${MB_BASE}/release?release-group=${rgid}&inc=recordings+media&fmt=json&limit=10`;
  const data = await mbFetch(url);

  const releases = (data.releases || []);
  if (releases.length === 0) return { releaseMbid: null, tracks: [] };

  // Pick the release with the most tracks
  const best = releases.sort((a, b) => {
    const aCount = (a.media || []).reduce((s, m) => s + (m['track-count'] || 0), 0);
    const bCount = (b.media || []).reduce((s, m) => s + (m['track-count'] || 0), 0);
    return bCount - aCount;
  })[0];

  const tracks = [];
  for (const medium of (best.media || [])) {
    for (const track of (medium.tracks || [])) {
      tracks.push({
        position: track.position,
        title: track.title || track.recording?.title || 'Unknown',
        lengthMs: track.length || track.recording?.length || null,
      });
    }
  }

  const result = { releaseMbid: best.id, tracks };
  cacheSet(key, result);
  return result;
}

module.exports = { searchReleases, searchArtists, browseArtistReleases, getCoverArtUrl, getReleaseTracks, getReleaseGroupTracks };
