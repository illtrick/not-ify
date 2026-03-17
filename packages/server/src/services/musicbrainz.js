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

// ── Query Normalization ──────────────────────────────────────────────────────
// Normalize a search query before sending to MB:
// - Accent/diacritic folding (MB does this too, but normalizing our side ensures consistency)
// - & → and (MB aliases handle "The X" but not always "&")
// - Strip excess punctuation that confuses Lucene
function normalizeQuery(q) {
  if (!q) return q;
  let n = q;
  // Accent fold: ø→o, ä→a, etc.
  n = n.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // & → and (but not inside Lucene field queries like "artist:X AND album:Y")
  n = n.replace(/&/g, 'and');
  // Strip Lucene special chars that users won't intend: + ! ( ) { } [ ] ^ " ~ * ? : \
  // Keep - (for hyphenated names) and / (for date ranges)
  n = n.replace(/[+!(){}[\]^"~*?:\\]/g, ' ');
  // Collapse whitespace
  n = n.replace(/\s{2,}/g, ' ').trim();
  return n;
}

// ── Fuzzy Search (Lucene ~ operator) ─────────────────────────────────────────
// When a standard search returns 0 results, retry with ~ appended to each term.
// MB's eDisMax parser supports Lucene fuzzy: "balmoreha~" finds "Balmorhea".
async function searchReleasesFuzzy(query) {
  const key = `releases-fuzzy:${query.toLowerCase().trim()}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    // Append ~ to each word for fuzzy matching (default edit distance 0.5)
    const fuzzyQ = query.split(/\s+/).map(w => w.length >= 3 ? `${w}~` : w).join(' ');
    const luceneQuery = `${fuzzyQ} NOT secondarytype:Live NOT secondarytype:Bootleg`;
    const url = `${MB_BASE}/release-group/?query=${encodeURIComponent(luceneQuery)}&fmt=json&limit=15&inc=releases`;
    const data = await mbFetch(url);
    const releases = parseReleaseGroups(data);
    cacheSet(key, releases);
    return releases;
  } catch (err) {
    console.error(`MusicBrainz fuzzy search failed: ${err.message}`);
    return [];
  }
}

// Fuzzy artist search with ~ operator
async function searchArtistsFuzzy(query) {
  const key = `artists-fuzzy:${query.toLowerCase().trim()}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const fuzzyQ = query.split(/\s+/).map(w => w.length >= 3 ? `${w}~` : w).join(' ');
    const url = `${MB_BASE}/artist/?query=${encodeURIComponent(fuzzyQ)}&fmt=json&limit=10`;
    const data = await mbFetch(url);

    const seen = new Map();
    for (const a of (data.artists || [])) {
      const normName = a.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!seen.has(normName) || (a.score || 0) > (seen.get(normName).score || 0)) {
        seen.set(normName, {
          mbid: a.id, name: a.name, type: a.type || null,
          disambiguation: a.disambiguation || null,
          sortName: a['sort-name'] || a.name, score: a.score || 0,
        });
      }
    }
    const artists = Array.from(seen.values()).slice(0, 6);
    cacheSet(key, artists);
    return artists;
  } catch (err) {
    console.error(`MusicBrainz fuzzy artist search failed: ${err.message}`);
    return [];
  }
}

// ── Release Ranking (for recording search) ──────────────────────────────────
// When a recording appears on multiple releases (studio album, live bootleg,
// compilation, etc.), pick the most "canonical" one.
function pickBestRelease(releases) {
  if (releases.length === 1) return releases[0];

  function releaseScore(r) {
    const rg = r['release-group'] || {};
    const primary = (rg['primary-type'] || '').toLowerCase();
    const secondaries = (rg['secondary-types'] || []).map(s => s.toLowerCase());
    let score = 0;

    // Primary type scoring
    if (primary === 'album') score += 100;
    else if (primary === 'ep') score += 60;
    else if (primary === 'single') score += 40;
    else score += 10;

    // Penalize secondary types (live, compilation, bootleg, etc.)
    if (secondaries.includes('live')) score -= 80;
    if (secondaries.includes('bootleg')) score -= 90;
    if (secondaries.includes('compilation')) score -= 30;
    if (secondaries.includes('remix')) score -= 40;
    if (secondaries.includes('demo')) score -= 50;
    if (secondaries.includes('dj-mix')) score -= 40;

    // No secondary types = official studio release → bonus
    if (secondaries.length === 0) score += 20;

    // Prefer releases with a date (well-catalogued)
    if (r.date) score += 5;

    return score;
  }

  return releases.slice().sort((a, b) => releaseScore(b) - releaseScore(a))[0];
}

// ── Recording Search (track-level) ───────────────────────────────────────────
// Search MB recordings to find specific tracks. Useful when query is "artist songname".
// Returns: [{ title, artist, album, rgid, mbid, year }]
async function searchRecordings(query) {
  const key = `recordings:${query.toLowerCase().trim()}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    // Add status:official to filter out bootleg recordings that dominate results for popular artists
    const filteredQuery = `${query} AND status:official`;
    const url = `${MB_BASE}/recording/?query=${encodeURIComponent(filteredQuery)}&fmt=json&limit=15`;
    const data = await mbFetch(url);

    // Collect all recording results, then deduplicate keeping the best release per artist::title
    const LIVE_ALBUM_RE = /^\d{4}-\d{2}-\d{2}[:\s]|^Live\s+(at|in|from)\b/i;
    const bestByKey = new Map(); // dedupKey → { entry, releaseQuality }

    for (const rec of (data.recordings || [])) {
      const artist = rec['artist-credit']?.[0]?.artist?.name || 'Unknown Artist';
      const releases = rec.releases || [];
      if (releases.length === 0) continue;
      const release = pickBestRelease(releases);
      const rgid = release['release-group']?.id || null;
      const mbid = release.id || null;
      const dedupKey = `${artist}::${rec.title}`.toLowerCase();

      // Score this release to decide if it's better than what we already have
      const rg = release['release-group'] || {};
      const primary = (rg['primary-type'] || '').toLowerCase();
      const secondaries = (rg['secondary-types'] || []).map(s => s.toLowerCase());
      let quality = 0;
      // Primary type: prefer Album > EP > Single
      if (primary === 'album') quality += 100;
      else if (primary === 'ep') quality += 60;
      else if (primary === 'single') quality += 40;
      else quality += 20;
      // Penalize secondary types
      if (secondaries.includes('live') || LIVE_ALBUM_RE.test(release.title || '')) quality -= 80;
      if (secondaries.includes('bootleg') || (release.status || '').toLowerCase() === 'bootleg') quality -= 90;
      if (secondaries.includes('compilation')) quality -= 30;
      if (secondaries.includes('soundtrack')) quality -= 20;
      // No secondary types = official studio release → bonus
      if (secondaries.length === 0 && (release.status || '').toLowerCase() !== 'bootleg') quality += 20;
      // Official status bonus
      if ((release.status || '').toLowerCase() === 'official') quality += 10;
      if (release.date) quality += 5;

      const existing = bestByKey.get(dedupKey);
      if (!existing || quality > existing.releaseQuality) {
        bestByKey.set(dedupKey, {
          entry: {
            title: rec.title,
            artist,
            artistMbid: rec['artist-credit']?.[0]?.artist?.id || null,
            album: release.title || '',
            rgid,
            mbid,
            year: release.date ? release.date.slice(0, 4) : '',
            score: rec.score || 0,
          },
          releaseQuality: quality,
        });
      }
    }

    const results = Array.from(bestByKey.values()).map(v => v.entry);

    cacheSet(key, results);
    return results;
  } catch (err) {
    console.error(`MusicBrainz recording search failed: ${err.message}`);
    return [];
  }
}

// ── Artist Detail Lookup ─────────────────────────────────────────────────────
// Full artist metadata: genres, external links, band members, country, active years
// Returns: { genres, country, area, activeYears, type, disambiguation, links, members }
async function getArtistDetails(mbid) {
  const key = `artist-detail:${mbid}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const url = `${MB_BASE}/artist/${mbid}?inc=genres+url-rels+artist-rels&fmt=json`;
    const data = await mbFetch(url);

    // Parse genres (sorted by count descending)
    const genres = (data.genres || [])
      .sort((a, b) => (b.count || 0) - (a.count || 0))
      .map(g => g.name)
      .slice(0, 8);

    // Parse external links from URL relationships
    const links = { wikipedia: null, wikidata: null, official: null, bandcamp: null, social: [] };
    for (const rel of (data.relations || [])) {
      if (rel['target-type'] !== 'url') continue;
      const href = rel.url?.resource;
      if (!href) continue;
      const t = rel.type;
      if (t === 'wikipedia') links.wikipedia = href;
      else if (t === 'wikidata') links.wikidata = href;
      else if (t === 'official homepage') links.official = href;
      else if (t === 'bandcamp' || (href && href.includes('bandcamp.com'))) links.bandcamp = href;
      else if (t === 'social network') links.social.push(href);
      else if (t === 'youtube' || t === 'video channel') links.youtube = href;
    }

    // Parse band members from artist-artist relationships (dedup by mbid)
    const memberMap = new Map();
    for (const rel of (data.relations || [])) {
      if (rel['target-type'] !== 'artist') continue;
      if (rel.type !== 'member of band') continue;
      const member = rel.direction === 'backward' ? rel.artist : null;
      if (!member) continue;
      // Keep the entry with the latest activity (prefer active over ended)
      const existing = memberMap.get(member.id);
      const ended = rel.ended || false;
      if (!existing || (!ended && existing.active === false)) {
        memberMap.set(member.id, {
          name: member.name,
          mbid: member.id,
          active: !ended,
          begin: rel.begin || existing?.begin || null,
          end: rel.end || null,
        });
      }
    }
    const members = Array.from(memberMap.values());

    const result = {
      genres,
      country: data.country || null,
      area: data.area?.name || null,
      beginArea: data['begin-area']?.name || null,
      activeYears: {
        begin: data['life-span']?.begin || null,
        end: data['life-span']?.end || null,
        ended: data['life-span']?.ended || false,
      },
      type: data.type || null,
      gender: data.gender || null,
      disambiguation: data.disambiguation || null,
      links,
      members: members.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0)),
    };

    cacheSet(key, result);
    return result;
  } catch (err) {
    console.error(`MusicBrainz artist detail failed: ${err.message}`);
    return null;
  }
}

module.exports = {
  searchReleases, searchArtists, browseArtistReleases,
  getCoverArtUrl, getReleaseTracks, getReleaseGroupTracks,
  searchReleasesFuzzy, searchArtistsFuzzy, searchRecordings,
  normalizeQuery, getArtistDetails,
};
