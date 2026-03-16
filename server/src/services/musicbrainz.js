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

// Parse a release-group API response into our internal format
function parseReleaseGroups(data) {
  const ALLOWED_PRIMARY = new Set(['Album', 'Single', 'EP', 'Compilation', 'Broadcast']);
  return (data['release-groups'] || [])
    .filter(rg => ALLOWED_PRIMARY.has(rg['primary-type'] || ''))
    .map(rg => {
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
    let releases = parseReleaseGroups(data);

    // If query contains "soundtrack"/"ost"/"score", also search with secondarytype:Soundtrack
    // to find releases like "Various Artists - Dark" where "soundtrack" is a type, not in the title
    const soundtrackWords = /\b(soundtrack|ost|score)\b/i;
    if (soundtrackWords.test(query)) {
      try {
        // Strip the soundtrack word from the query and add type filter
        const cleanedQ = query.replace(soundtrackWords, '').replace(/\s{2,}/g, ' ').trim();
        if (cleanedQ.length >= 2) {
          const stQuery = `${cleanedQ} AND secondarytype:Soundtrack`;
          const stUrl = `${MB_BASE}/release-group/?query=${encodeURIComponent(stQuery)}&fmt=json&limit=10&inc=releases`;
          const stData = await mbFetch(stUrl);
          const stReleases = parseReleaseGroups(stData);
          // Merge: soundtrack results first, then general (dedup by rgid)
          const seenRgids = new Set(stReleases.map(r => r.rgid));
          releases = [...stReleases, ...releases.filter(r => !seenRgids.has(r.rgid))];
        }
      } catch (err) {
        console.error(`Soundtrack-specific search failed: ${err.message}`);
      }
    }

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
// Returns: [{ position, title, lengthMs, artist?, artistMbid? }]
async function getReleaseTracks(mbid) {
  const key = `tracks:${mbid}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const url = `${MB_BASE}/release/${mbid}?inc=recordings+artist-credits&fmt=json`;
  const data = await mbFetch(url);

  // Check if this is a VA / multi-artist release
  const releaseArtist = data['artist-credit']?.[0]?.artist?.name || '';
  const isVA = /various artists/i.test(releaseArtist);

  const tracks = [];
  for (const medium of (data.media || [])) {
    for (const track of (medium.tracks || [])) {
      const ac = track['artist-credit'] || track.recording?.['artist-credit'];
      const trackArtist = ac?.[0]?.artist?.name || null;
      const trackArtistMbid = ac?.[0]?.artist?.id || null;
      const entry = {
        position: track.position,
        title: track.title || track.recording?.title || 'Unknown',
        lengthMs: track.length || track.recording?.length || null,
      };
      // Include per-track artist if it's a VA release or differs from main artist
      if (trackArtist && (isVA || trackArtist.toLowerCase() !== releaseArtist.toLowerCase())) {
        entry.artist = trackArtist;
        entry.artistMbid = trackArtistMbid;
      }
      tracks.push(entry);
    }
  }

  cacheSet(key, tracks);
  return tracks;
}

// Get tracks for a release-group (resolves to best release, then gets tracks)
// Returns: { releaseMbid, tracks: [{ position, title, lengthMs, artist?, artistMbid? }] }
async function getReleaseGroupTracks(rgid) {
  const key = `rg-tracks:${rgid}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  // Browse releases within this release-group, include artist-credits for VA detection
  const url = `${MB_BASE}/release?release-group=${rgid}&inc=recordings+media+artist-credits&fmt=json&limit=10`;
  const data = await mbFetch(url);

  const releases = (data.releases || []);
  if (releases.length === 0) return { releaseMbid: null, tracks: [] };

  // Pick the release with the most tracks
  const best = releases.sort((a, b) => {
    const aCount = (a.media || []).reduce((s, m) => s + (m['track-count'] || 0), 0);
    const bCount = (b.media || []).reduce((s, m) => s + (m['track-count'] || 0), 0);
    return bCount - aCount;
  })[0];

  const releaseArtist = best['artist-credit']?.[0]?.artist?.name || '';
  const isVA = /various artists/i.test(releaseArtist);

  const tracks = [];
  for (const medium of (best.media || [])) {
    for (const track of (medium.tracks || [])) {
      const ac = track['artist-credit'] || track.recording?.['artist-credit'];
      const trackArtist = ac?.[0]?.artist?.name || null;
      const trackArtistMbid = ac?.[0]?.artist?.id || null;
      const entry = {
        position: track.position,
        title: track.title || track.recording?.title || 'Unknown',
        lengthMs: track.length || track.recording?.length || null,
      };
      if (trackArtist && (isVA || trackArtist.toLowerCase() !== releaseArtist.toLowerCase())) {
        entry.artist = trackArtist;
        entry.artistMbid = trackArtistMbid;
      }
      tracks.push(entry);
    }
  }

  const result = { releaseMbid: best.id, tracks };
  cacheSet(key, result);
  return result;
}

module.exports = { searchReleases, searchArtists, browseArtistReleases, getCoverArtUrl, getReleaseTracks, getReleaseGroupTracks };
