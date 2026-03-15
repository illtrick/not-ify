const express = require('express');
const { searchMusic } = require('../services/search');
const { searchReleases, searchArtists, browseArtistReleases, getReleaseTracks, getReleaseGroupTracks } = require('../services/musicbrainz');
const { searchYouTube, searchSoundCloud } = require('../services/youtube');
const llm = require('../services/llm');

const router = express.Router();

// Decode common HTML entities from torrent names
function decodeEntities(s) {
  return (s || '')
    .replace(/&amp;/gi, '&')
    .replace(/&rsquo;/gi, "'")
    .replace(/&lsquo;/gi, "'")
    .replace(/&rdquo;/gi, '"')
    .replace(/&ldquo;/gi, '"')
    .replace(/&hellip;/gi, '...')
    .replace(/&ndash;/gi, '-')
    .replace(/&mdash;/gi, '-')
    .replace(/&bull;/gi, '·')
    .replace(/&aelig;/gi, 'ae')
    .replace(/&oslash;/gi, 'o')
    .replace(/&auml;/gi, 'a')
    .replace(/&ouml;/gi, 'o')
    .replace(/&uuml;/gi, 'u')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCharCode(parseInt(n, 10)); } catch { return ''; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCharCode(parseInt(h, 16)); } catch { return ''; } });
}

// Strip quality/format words that slipped into display names
const QUALITY_WORD_RE = /\b(FLAC|MP3|320k(?:bps?)?|320|V0|V2|Lossless|24[\s-]?bit|AAC|OGG|OPUS|WAV|APE|WMA|CBR|VBR|\d*kbps?|WEB[-\s]?FLAC|WEB|CUE|iTunes|vinyl|Pack)\b/gi;

// Genre/category tags — only strip when bracketed or after separator at end of string
// This avoids stripping genre words that are part of artist/album names (e.g. "Daft Punk", "Pop Smoke")
const GENRE_BRACKET_RE = /[\[({][^\]})]*\b(Rap|Hip[-\s]?Hop|Rock|Metal|Pop|Jazz|Blues|Country|Classical|Electronic|Indie|Alternative|Punk|Folk|Soul|R&B|RnB|Reggae|Latin|World|Beats|Instrumentals?|Lo[-\s]?Fi|Downtempo|IDM)\b[^\]})]*[\]})]/gi;
// Only strip trailing genre when preceded by dash/separator (not just space) to avoid "Daft Punk" → "Daft"
const GENRE_TRAILING_RE = /\s+[-–—]\s+(Rap|Hip[-\s]?Hop|Rock|Metal|Pop|Jazz|Blues|Country|Classical|Electronic|Indie|Alternative|Punk|Folk|Soul|R&B|RnB|Reggae|Latin|World|Beats|Instrumentals?|Lo[-\s]?Fi)\s*$/gi;

// Known uploader/group tags (case-insensitive)
const UPLOADER_RE = /[-\s#]+(eNJoY[-\s]*iT|FANG|FTD|NoGroup|ausy|btptp|EAC|rutracker|politux|peaSoup|pea_soup|dBp|SiLvErDuSt\w*|sEcTiOn\w*|DarkAngie|NewAlbumReleases|PMEDIA|Soup|INCOGNITO\w*|TNT[-\s]*Village|CHANNEL[-\s]*NEO|PBTHAL|Jamal[-\s]*The[-\s]*Moroccan|C4|Kitlope|vtwin\w*|R3C0NF1GUR3D\w*)\s*$/gi;

// Clean a parsed torrent name for display
function cleanDisplayName(s) {
  if (!s) return '';
  s = decodeEntities(s);
  // Fix escaped quotes from torrent names: \' → ', \" → "
  s = s.replace(/\\'/g, "'").replace(/\\"/g, '"');
  // Strip HTML quotes that survived entity decoding
  s = s.replace(/&quot;/gi, '"');
  // Strip quality words (including underscore variants like 320_kbps)
  s = s.replace(/\d+[_-]?kbps?/gi, '');
  s = s.replace(QUALITY_WORD_RE, '');
  // Strip genre tags only when bracketed or trailing after separator (avoids "Daft Punk" → "Daft")
  s = s.replace(GENRE_BRACKET_RE, '');
  s = s.replace(GENRE_TRAILING_RE, '');
  // Strip disc/CD count references like "4 CD", "10 CD", "2CD"
  s = s.replace(/\b\d+\s*CD\b/gi, '');
  // Strip compilation/metadata words
  s = s.replace(/\b(STUDIO|Discography|Oficial|Official|Complete|Compilation|Anthology|Collection)\b/gi, '');
  // Strip common bracket artifacts: [VinylRip], [RollingStones #...], (Remaster...), [Mono & Stereo]
  s = s.replace(/[\[({][^\]})]*(?:Rip|Remaster|Deluxe|Edition|Mono|Stereo|Vinyl|SACD|HDCD|DSD|Bonus|Import|Collector|Anniversary|Bit)[^\]})]*[\]})]/gi, '');
  // Strip incomplete brackets at end: "(Vinyl Rip" without closing paren
  s = s.replace(/[\[({][^\]})]*$/g, '');
  // Strip remaining square/curly bracket content that looks like metadata or uploader tags
  s = s.replace(/\[[^\]]*\d{3,}[^\]]*\]/g, '');
  s = s.replace(/\[(?:PMEDIA|DarkAngie|NewAlbumReleases|Soup|EAC|rutracker|INCOGNITO\w*|PBTHAL|Dark\w*|CHANNEL\s*NEO)\]/gi, '');
  // Strip parenthesized uploader tags: "(Jamal The Moroccan)", "(PBTHAL)"
  s = s.replace(/\((?:Jamal\s*The\s*Moroccan|PBTHAL|PMEDIA|DarkAngie)\)/gi, '');
  // Strip bracket-enclosed genre/format tags like "[Downtempo, IDM]", "[UK Garage, Dubstep]"
  s = s.replace(/\[[^\]]*(?:Downtempo|IDM|Garage|Dubstep|Ambient|Techno|Breakbeat|House|Trance|DnB|Drum\s*&?\s*Bass)[^\]]*\]/gi, '');
  // Strip emoji characters (common in torrent names for "verified" badges etc.)
  s = s.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{2B55}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu, '');
  // Strip @ uploader tags like "@ pea_soup" or trailing "- @"
  s = s.replace(/@\s*\S+/g, '');
  s = s.replace(/[-\s]+@\s*$/g, '');
  // Strip hash-delimited tags like "#sEcTiOn8#" (before uploader regex so it can match cleanly)
  s = s.replace(/#[^#\s]+#/g, '');
  // Strip known uploader/group tags (run multiple times for chained tags like "dBp peaSoup")
  s = s.replace(UPLOADER_RE, '');
  s = s.replace(UPLOADER_RE, '');
  // Strip trailing mixed-case tags that look like uploader handles (e.g. "SiLvErDuStSeCtiOn84")
  s = s.replace(/[-\s]+[A-Z][a-z]+(?:[A-Z][a-z]+){2,}\w*\s*$/g, '');
  // Strip trailing strings with excessive case alternation (e.g. "SiLvErDuSt")
  s = s.replace(/[-\s]+(?:[A-Z][a-z]){4,}\w*\s*$/g, '');
  // Also strip if attached to previous word via hyphen: "Come-SiLvErDuSt" → keep "Come"
  s = s.replace(/-(?:[A-Z][a-z]){4,}\w*\s*$/g, '');
  // Strip trailing artifact numbers like " 88" (torrent dedup IDs)
  s = s.replace(/\s+\d{1,3}$/, '');
  // Strip trailing " - , - " artifacts from double-separator torrent name parsing
  s = s.replace(/\s*[-,]\s*[-,]\s*$/g, '');
  // Replace dots/underscores used as word separators
  s = s.replace(/([a-zA-Z])\.([a-zA-Z])/g, '$1 $2');
  s = s.replace(/_/g, ' ');
  // Fix double dashes/dots: "Broadway--Ballads" → "Broadway-Ballads"
  s = s.replace(/-{2,}/g, '-');
  s = s.replace(/\.{2,}/g, '.');
  // Strip year ranges (bare or bracketed): "(1984-2008)", "1982-2012", "[ - ]"
  s = s.replace(/[\(\[]?\d{4}\s*[-–·]\s*\d{4}[\)\]]?/g, '');
  s = s.replace(/\[\s*[-–—]*\s*\]/g, '');
  // Strip trailing bare years: "- 2011"
  s = s.replace(/[-\s]+(19|20)\d{2}\s*$/g, '');
  // Strip trailing orphaned conjunctions/articles (from stripped content)
  s = s.replace(/\s+(and|or|&|More|The)\s*$/gi, '');
  s = s.replace(/\s+(and|or|&|More|The)\s*$/gi, '');
  // Strip wrapping or stray quotes from album names: "Singles" → Singles
  s = s.replace(/^["'](.+)["']$/, '$1');
  s = s.replace(/[""]+/g, '');
  // Clean leftover separators at start/end
  s = s.replace(/^[\s\-–—·_#]+|[\s\-–—·_#]+$/g, '').replace(/\s{2,}/g, ' ');
  s = s.trim();
  // If the cleaned name is just a stop word, return empty (will fall back to torrent name)
  if (/^(The|A|An|And|Or)$/i.test(s)) return '';
  return s;
}

// Normalize a string for fuzzy matching: lowercase alphanumeric only, unicode-folded
function normalize(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Simple edit distance for catching typos (e.g. "Megadeath" vs "Megadeth")
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 4) return 99;
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

// Parse a torrent name into { artist, album, quality, year }
function parseTorrentName(name) {
  const QUALITY_RE = /\b(FLAC|320|MP3|V0|Lossless|24bit|24-bit|AAC|OGG)\b/i;
  const bracketRe = /[\[({]([^\]})]+)[\]})]/g;

  let quality = '';
  const bracketContent = [];
  let m;
  while ((m = bracketRe.exec(name)) !== null) {
    const inner = m[1];
    const qm = inner.match(QUALITY_RE);
    if (qm && !quality) quality = qm[0].toUpperCase();
    bracketContent.push(m[0]);
  }

  const yearMatch = name.match(/(19|20)\d{2}/);
  const year = yearMatch ? yearMatch[0] : '';

  let stripped = name;
  for (const b of bracketContent) stripped = stripped.replace(b, '');
  stripped = stripped.replace(/(19|20)\d{2}/, '').replace(/\s+/g, ' ').trim();

  const parts = stripped.split(/\s+[-\u2013\u2014]\s+/).map(p => p.trim()).filter(Boolean);

  if (parts.length < 2) {
    return { artist: '', album: stripped || name, quality, year };
  }
  return { artist: parts[0], album: parts.slice(1).join(' - '), quality, year };
}

// Try to match a torrent's parsed artist+album to a MusicBrainz release
function matchToRelease(torrentArtist, torrentAlbum, mbReleases) {
  const nArtist = normalize(torrentArtist);
  const nAlbum = normalize(torrentAlbum);

  if (!nArtist || !nAlbum) return null;

  for (const rel of mbReleases) {
    const nRelArtist = normalize(rel.artist);
    const nRelAlbum = normalize(rel.album);

    // Check artist: containment, initials handling, or small edit distance (typos)
    const artistMatch =
      nRelArtist.includes(nArtist) ||
      nArtist.includes(nRelArtist) ||
      nRelArtist.replace(/\./g, '').includes(nArtist.replace(/\./g, '')) ||
      editDistance(nArtist, nRelArtist) <= 2;

    // Check album containment
    const albumMatch =
      nRelAlbum.includes(nAlbum) ||
      nAlbum.includes(nRelAlbum);

    if (artistMatch && albumMatch) return rel;
  }
  return null;
}

// Score a torrent source for ranking: quality > seeders > size sanity
function scoreSource(source) {
  let score = 0;
  const q = (source.quality || '').toUpperCase();
  // Quality bonus
  if (/FLAC|LOSSLESS|24.?BIT/i.test(q)) score += 30;
  else if (/320/i.test(q)) score += 20;
  else if (/V0/i.test(q)) score += 15;
  else if (/MP3/i.test(q)) score += 5;
  // Seeder bonus (log scale, cap at 25)
  score += Math.min(Math.log2((source.seeders || 0) + 1) * 5, 25);
  // Size penalty: likely compilation (>2GB) or incomplete (<30MB)
  const bytes = source.size || 0;
  if (bytes > 2 * 1024 * 1024 * 1024) score -= 10;
  if (bytes > 0 && bytes < 30 * 1024 * 1024) score -= 15;
  return score;
}

// Normalize a group key for unmatched torrents: strip quality/year/collection/remaster words so variants merge
function rawGroupKey(artist, album) {
  const clean = (s) => normalize(s)
    .replace(/discography|collection|complete|boxset|box/g, '')
    .replace(/flac|mp3|320|v0|v2|lossless|aac|ogg|opus|wav|web/g, '')
    .replace(/remaster(?:ed)?|deluxe|edition|expanded|bonus|anniversary|special|explicit|censored/g, '')
    .replace(/\d{4}/g, '');
  return `raw:${clean(artist)}::${clean(album)}`;
}

// Check if a parsed torrent artist fuzzy-matches the primary/expected artist
function artistRelevant(torrentArtist, primaryArtist, query) {
  if (!torrentArtist) return true; // no artist parsed — keep it, will get grouped by album
  const nTorrent = normalize(torrentArtist);
  const nPrimary = normalize(primaryArtist);
  const nQuery = normalize(query);
  if (!nTorrent) return true;
  // Strict: torrent artist must closely match the primary MB artist or query
  // "Demon Tool" vs "Tool" — nTorrent includes nPrimary but that's too loose
  // Require: exact match, small edit distance, or the torrent artist IS the query/primary (not just contains)
  if (nTorrent === nPrimary || nTorrent === nQuery) return true;
  if (editDistance(nTorrent, nPrimary) <= 2) return true;
  if (editDistance(nTorrent, nQuery) <= 2) return true;
  // Allow "the tool" vs "tool" style differences
  if (nTorrent.replace(/^the/, '') === nPrimary.replace(/^the/, '')) return true;
  return false;
}

// Detect junk torrent releases that shouldn't be shown
const JUNK_RE = /custom\s+remaster|remaster(?:ed)?\s+by|remaster\s+by/i;
const AGGREGATOR_RE = /\b(QOBUZ|Tidal|HDtracks|HDTracks)\b/i;
const BOOTLEG_RE = /\b(bootleg|unofficial)\b/i;
const COMPILATION_WORDS = /\b(essentials|greatest\s+hits|best\s+of|best\s+songs|diamond\s+collection)\b/i;

function isJunkTorrent(name, query) {
  if (JUNK_RE.test(name)) return true;
  if (AGGREGATOR_RE.test(name)) return true;
  if (BOOTLEG_RE.test(name)) return true;
  // Only filter compilations if the user didn't search for them
  const nq = query.toLowerCase();
  if (COMPILATION_WORDS.test(name) && !COMPILATION_WORDS.test(nq)) return true;
  return false;
}

// GET /api/search?q=...
router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing query parameter q' });

  try {
    // Run both searches in parallel
    const [torrents, mbReleases, mbArtists] = await Promise.all([
      searchMusic(q),
      searchReleases(q),
      searchArtists(q),
    ]);

    // Determine the primary artist for relevance filtering
    const primaryArtist = mbArtists[0]?.name || q;

    // If we have a strong artist match (score >= 90), browse their discography
    // This gives us canonical album data that generic release-group search misses
    // (e.g. searching "tool" as release-group returns albums titled "Tool" by random artists)
    let allMbReleases = mbReleases;
    if (mbArtists[0]?.score >= 90 && mbArtists[0]?.mbid) {
      try {
        const artistReleases = await browseArtistReleases(mbArtists[0].mbid, mbArtists[0].name);
        // Merge: artist browse results first, then generic search results (dedup by rgid)
        const seenRgids = new Set(artistReleases.map(r => r.rgid));
        allMbReleases = [...artistReleases, ...mbReleases.filter(r => !seenRgids.has(r.rgid))];
      } catch (err) {
        console.error(`Artist browse failed, using generic results: ${err.message}`);
      }
    }

    // Group torrents into albums
    const groups = new Map(); // key -> { mbRelease or null, artist, album, year, quality, sources[] }
    const regexFailures = []; // torrent names where regex couldn't extract artist

    for (const torrent of torrents) {
      // Filter junk torrents (custom remasters, aggregator labels, bootlegs)
      if (isJunkTorrent(torrent.name, q)) continue;

      // Check LLM cache first — previous background parses may have improved results
      const llmCached = llm.getCachedParse(torrent.name);
      const parsed = llmCached
        ? { artist: llmCached.artist, album: llmCached.album, quality: llmCached.quality || '', year: llmCached.year || '' }
        : parseTorrentName(torrent.name);

      // Track regex failures for async LLM parsing
      if (!llmCached && !parsed.artist) {
        regexFailures.push(torrent.name);
      }

      // Filter torrents from wrong artists (e.g. "Demon Tool" when searching "Tool")
      if (!artistRelevant(parsed.artist, primaryArtist, q)) continue;

      const mbMatch = matchToRelease(parsed.artist, parsed.album, allMbReleases);

      // Group key: prefer MusicBrainz ID, fall back to normalized artist::album
      const groupKey = mbMatch
        ? `mb:${mbMatch.rgid || mbMatch.mbid}`
        : rawGroupKey(parsed.artist, parsed.album || torrent.name);

      if (!groups.has(groupKey)) {
        // Clean display names for unmatched torrents
        const displayArtist = mbMatch?.artist || cleanDisplayName(parsed.artist) || torrent.name;
        const displayAlbum = mbMatch?.album || cleanDisplayName(parsed.album) || cleanDisplayName(torrent.name);

        groups.set(groupKey, {
          mbRelease: mbMatch || null,
          artist: displayArtist,
          album: displayAlbum,
          year: mbMatch?.year || parsed.year || '',
          coverArt: mbMatch
            ? (mbMatch.rgid
                ? `/api/cover/rg/${mbMatch.rgid}${mbMatch.mbid ? `?mbid=${mbMatch.mbid}` : ''}`
                : `/api/cover/${mbMatch.mbid}`)
            : null,
          mbid: mbMatch?.mbid || null,
          rgid: mbMatch?.rgid || null,
          trackCount: mbMatch?.trackCount || null,
          sources: [],
        });
      }

      groups.get(groupKey).sources.push({
        id: torrent.id,
        name: torrent.name,
        magnetLink: torrent.magnetLink,
        quality: parsed.quality || '',
        seeders: torrent.seeders,
        leechers: torrent.leechers,
        sizeFormatted: torrent.sizeFormatted,
        size: torrent.size,
      });
    }

    // Convert to array, split into MB-matched and unmatched
    const mbMatched = [];
    const unmatched = [];
    for (const [key, group] of groups) {
      group.sources.sort((a, b) => scoreSource(b) - scoreSource(a));
      const best = group.sources[0];
      const entry = {
        id: key,
        artist: group.artist,
        album: group.album,
        year: group.year,
        coverArt: group.coverArt,
        mbid: group.mbid,
        rgid: group.rgid || null,
        trackCount: group.trackCount,
        hasCoverArt: group.coverArt !== null,
        bestSeeders: best?.seeders || 0,
        sources: group.sources,
      };

      if (group.mbRelease) {
        mbMatched.push(entry);
      } else {
        unmatched.push(entry);
      }
    }

    // Sort MB-matched by year (newest first), then seeders
    mbMatched.sort((a, b) => {
      const ya = parseInt(a.year) || 0, yb = parseInt(b.year) || 0;
      if (ya !== yb) return yb - ya;
      return b.bestSeeders - a.bestSeeders;
    });

    // Sort unmatched by seeders
    unmatched.sort((a, b) => b.bestSeeders - a.bestSeeders);

    // Primary: MB-matched (clean canonical albums), limited to 20
    const albums = mbMatched.slice(0, 20);
    // Secondary: unmatched torrents that passed filters, limited to 10
    const otherResults = unmatched.slice(0, 10);

    // If no torrent results at all, search YouTube + SoundCloud as fallback
    let streamingResults = [];
    let mbAlbums = [];
    if (albums.length === 0 && otherResults.length === 0) {
      try {
        const [ytResults, scResults] = await Promise.all([
          searchYouTube(q, 15).catch(() => []),
          searchSoundCloud(q, 10).catch(() => []),
        ]);
        streamingResults = [
          ...ytResults.map(r => ({
            id: r.id,
            title: r.title,
            artist: r.channel,
            thumbnail: r.thumbnail,
            duration: r.duration,
            url: r.url,
            source: 'youtube',
          })),
          ...scResults.map(r => ({
            id: r.id,
            title: r.title,
            artist: r.channel,
            thumbnail: r.thumbnail,
            duration: r.duration,
            url: r.url,
            source: 'soundcloud',
          })),
        ];
      } catch (err) {
        console.error(`Streaming search fallback error: ${err.message}`);
      }

      // Include MusicBrainz albums (no torrent sources) so client can show Albums section
      mbAlbums = allMbReleases.slice(0, 12).map(rel => ({
        id: `mb:${rel.rgid || rel.mbid}`,
        artist: rel.artist,
        album: rel.album,
        year: rel.year || '',
        coverArt: rel.rgid
          ? `/api/cover/rg/${rel.rgid}${rel.mbid ? `?mbid=${rel.mbid}` : ''}`
          : rel.mbid ? `/api/cover/${rel.mbid}` : null,
        mbid: rel.mbid,
        rgid: rel.rgid || null,
        trackCount: rel.trackCount || null,
      }));
    }

    res.json({ query: q, albums, otherResults, artists: mbArtists, streamingResults, mbAlbums });

    // Fire-and-forget: LLM parses regex failures in background, populates cache
    // Next search for same terms will hit cache and return better results
    if (regexFailures.length > 0) {
      llm.parseTorrentNamesAsync(regexFailures);
    }
  } catch (err) {
    console.error(`Search error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/mb/release/:mbid/tracks — fetch track listing from MusicBrainz
router.get('/mb/release/:mbid/tracks', async (req, res) => {
  const { mbid } = req.params;
  if (!/^[0-9a-f-]{36}$/.test(mbid)) return res.status(400).json({ error: 'Invalid mbid' });
  try {
    const tracks = await getReleaseTracks(mbid);
    res.json({ tracks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/mb/release-group/:rgid/tracks — resolve release-group to tracks
router.get('/mb/release-group/:rgid/tracks', async (req, res) => {
  const { rgid } = req.params;
  if (!/^[0-9a-f-]{36}$/.test(rgid)) return res.status(400).json({ error: 'Invalid rgid' });
  try {
    const result = await getReleaseGroupTracks(rgid);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/artist/:mbid — Artist page: info + discography
router.get('/artist/:mbid', async (req, res) => {
  const { mbid } = req.params;
  const { name } = req.query;
  if (!/^[0-9a-f-]{36}$/.test(mbid)) return res.status(400).json({ error: 'Invalid mbid' });

  try {
    const artistName = name || 'Unknown Artist';
    const releases = await browseArtistReleases(mbid, artistName);

    // Add cover art URLs
    const withCoverArt = releases.map(r => ({
      ...r,
      coverArt: r.rgid
        ? `/api/cover/rg/${r.rgid}${r.mbid ? `?mbid=${r.mbid}` : ''}`
        : r.mbid ? `/api/cover/${r.mbid}` : null,
    }));

    res.json({ mbid, name: artistName, releases: withCoverArt });
  } catch (err) {
    console.error(`Artist endpoint error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
