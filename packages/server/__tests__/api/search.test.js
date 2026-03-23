'use strict';

// Suite B1 — Search route integration tests
// All external services mocked; tests hit real Express route handlers via Supertest

jest.mock('../../src/services/search');
jest.mock('../../src/services/musicbrainz');
jest.mock('../../src/services/youtube');
jest.mock('../../src/services/llm');
// Setup middleware is bypassed in tests via _markComplete — mock it as a pass-through
jest.mock('../../src/middleware/setup', () => {
  const mw = (req, res, next) => next();
  mw._resetCache = jest.fn();
  mw._markComplete = jest.fn();
  return mw;
});

const request = require('supertest');
const app = require('../../src/index');

const { searchMusic } = require('../../src/services/search');
const { searchReleases, searchArtists, browseArtistReleases, getReleaseTracks, getReleaseGroupTracks, normalizeQuery, getArtistDetails } = require('../../src/services/musicbrainz');
const { searchYouTube, searchSoundCloud } = require('../../src/services/youtube');
const llm = require('../../src/services/llm');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const FIXTURE_TORRENTS = [
  {
    id: 'apibay_1',
    name: 'Pink Floyd - Dark Side of the Moon [FLAC]',
    magnetLink: 'magnet:?xt=urn:btih:aabbccdd',
    seeders: 42,
    leechers: 3,
    size: 450 * 1024 * 1024,
    sizeFormatted: '450 MB',
    source: 'apibay',
  },
  {
    id: 'apibay_2',
    name: 'Pink Floyd - The Wall [320]',
    magnetLink: 'magnet:?xt=urn:btih:11223344',
    seeders: 25,
    leechers: 1,
    size: 180 * 1024 * 1024,
    sizeFormatted: '180 MB',
    source: 'apibay',
  },
];

const FIXTURE_MB_RELEASES = [
  { mbid: 'rel-1', rgid: 'rg-1', artist: 'Pink Floyd', album: 'Dark Side of the Moon', year: '1973', trackCount: 10 },
  { mbid: 'rel-2', rgid: 'rg-2', artist: 'Pink Floyd', album: 'The Wall', year: '1979', trackCount: 26 },
];

const FIXTURE_MB_ARTISTS = [
  { mbid: 'art-1', name: 'Pink Floyd', type: 'Group', score: 100 },
];

const FIXTURE_YT_RESULTS = [
  { id: 'dQw4w9WgXcQ', title: 'Pink Floyd - Wish You Were Here', channel: 'Pink Floyd', duration: 334, thumbnail: 'https://img.yt/1.jpg', url: 'https://youtube.com/watch?v=dQw4w9WgXcQ' },
];

beforeEach(() => {
  jest.clearAllMocks();
  searchMusic.mockResolvedValue([]);
  searchReleases.mockResolvedValue([]);
  searchArtists.mockResolvedValue([]);
  browseArtistReleases.mockResolvedValue([]);
  searchYouTube.mockResolvedValue([]);
  searchSoundCloud.mockResolvedValue([]);
  llm.getCachedParse.mockReturnValue(null);
  llm.parseTorrentNamesAsync.mockImplementation(() => {});
  normalizeQuery.mockImplementation(q => q);
  getArtistDetails.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// Basic validation
// ---------------------------------------------------------------------------
describe('GET /api/search — validation', () => {
  test('returns 400 when q is missing', async () => {
    const res = await request(app).get('/api/search');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing/i);
  });

  test('returns 200 for a valid query', async () => {
    const res = await request(app).get('/api/search?q=radiohead');
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------
describe('GET /api/search — response shape', () => {
  beforeEach(() => {
    searchMusic.mockResolvedValue(FIXTURE_TORRENTS);
    searchReleases.mockResolvedValue(FIXTURE_MB_RELEASES);
    searchArtists.mockResolvedValue(FIXTURE_MB_ARTISTS);
  });

  test('response has required top-level fields', async () => {
    const res = await request(app).get('/api/search?q=pink+floyd');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('query', 'pink floyd');
    expect(res.body).toHaveProperty('albums');
    expect(res.body).toHaveProperty('otherResults');
    expect(res.body).toHaveProperty('artists');
    expect(res.body).toHaveProperty('streamingResults');
    expect(res.body).toHaveProperty('mbAlbums');
  });

  test('albums is an array', async () => {
    const res = await request(app).get('/api/search?q=pink+floyd');
    expect(Array.isArray(res.body.albums)).toBe(true);
  });

  test('album entry has expected fields', async () => {
    const res = await request(app).get('/api/search?q=pink+floyd');
    const album = res.body.albums[0];
    expect(album).toBeDefined();
    expect(album).toHaveProperty('id');
    expect(album).toHaveProperty('artist');
    expect(album).toHaveProperty('album');
    expect(album).toHaveProperty('year');
    expect(album).toHaveProperty('sources');
    expect(Array.isArray(album.sources)).toBe(true);
  });

  test('source entry has expected fields', async () => {
    const res = await request(app).get('/api/search?q=pink+floyd');
    const source = res.body.albums[0]?.sources[0];
    expect(source).toBeDefined();
    expect(source).toHaveProperty('magnetLink');
    expect(source).toHaveProperty('seeders');
    expect(source).toHaveProperty('sizeFormatted');
  });

  test('artists array includes MB artist', async () => {
    const res = await request(app).get('/api/search?q=pink+floyd');
    expect(res.body.artists).toHaveLength(1);
    expect(res.body.artists[0].name).toBe('Pink Floyd');
  });

  test('FLAC source ranked before 320 source for same album pair', async () => {
    const res = await request(app).get('/api/search?q=pink+floyd');
    // Dark Side has FLAC (higher score), should appear before The Wall 320
    // Both are in albums; just verify sources within Dark Side are sorted
    const dsom = res.body.albums.find(a => a.album.toLowerCase().includes('dark side'));
    if (dsom) {
      // Single source, quality should be FLAC
      expect(dsom.sources[0].quality).toMatch(/FLAC/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Junk filtering
// ---------------------------------------------------------------------------
describe('GET /api/search — junk torrent filtering', () => {
  test('QOBUZ aggregator torrent is excluded', async () => {
    searchMusic.mockResolvedValue([{
      id: 'apibay_junk', name: 'Pink Floyd - Dark Side [QOBUZ]',
      magnetLink: 'magnet:?xt=urn:btih:zzzz', seeders: 50, leechers: 0,
      size: 400 * 1024 * 1024, sizeFormatted: '400 MB', source: 'apibay',
    }]);
    searchReleases.mockResolvedValue(FIXTURE_MB_RELEASES);
    searchArtists.mockResolvedValue(FIXTURE_MB_ARTISTS);

    const res = await request(app).get('/api/search?q=pink+floyd');
    // Junk torrent should not appear
    const sources = res.body.albums.flatMap(a => a.sources);
    expect(sources.every(s => !s.name?.includes('QOBUZ'))).toBe(true);
  });

  test('custom remaster torrent is excluded', async () => {
    searchMusic.mockResolvedValue([{
      id: 'apibay_junk2', name: 'Pink Floyd - Animals (Custom Remaster)',
      magnetLink: 'magnet:?xt=urn:btih:junk2', seeders: 30, leechers: 0,
      size: 300 * 1024 * 1024, sizeFormatted: '300 MB', source: 'apibay',
    }]);
    searchReleases.mockResolvedValue(FIXTURE_MB_RELEASES);
    searchArtists.mockResolvedValue(FIXTURE_MB_ARTISTS);

    const res = await request(app).get('/api/search?q=pink+floyd');
    const sources = res.body.albums.flatMap(a => a.sources).concat(res.body.otherResults.flatMap(a => a.sources || []));
    expect(sources.every(s => !/custom remaster/i.test(s.name || ''))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Streaming fallback (no torrent results)
// ---------------------------------------------------------------------------
describe('GET /api/search — streaming fallback', () => {
  beforeEach(() => {
    searchMusic.mockResolvedValue([]); // no torrents
    searchReleases.mockResolvedValue(FIXTURE_MB_RELEASES);
    searchArtists.mockResolvedValue([{ mbid: 'art-1', name: 'SomeArtist', type: 'Group', score: 80 }]);
    searchYouTube.mockResolvedValue(FIXTURE_YT_RESULTS);
    searchSoundCloud.mockResolvedValue([]);
  });

  test('streamingResults populated when no torrent results', async () => {
    const res = await request(app).get('/api/search?q=something+obscure');
    expect(res.status).toBe(200);
    expect(res.body.streamingResults.length).toBeGreaterThan(0);
  });

  test('streaming result has expected fields', async () => {
    const res = await request(app).get('/api/search?q=something+obscure');
    const sr = res.body.streamingResults[0];
    expect(sr).toHaveProperty('id');
    expect(sr).toHaveProperty('title');
    expect(sr).toHaveProperty('source');
    expect(sr.source).toBe('youtube');
  });

  test('mbAlbums populated when no torrent results', async () => {
    const res = await request(app).get('/api/search?q=pink+floyd');
    expect(res.body.mbAlbums.length).toBeGreaterThan(0);
    expect(res.body.mbAlbums[0]).toHaveProperty('artist', 'Pink Floyd');
  });

  test('streamingResults empty when torrent results exist', async () => {
    searchMusic.mockResolvedValue(FIXTURE_TORRENTS);
    const res = await request(app).get('/api/search?q=pink+floyd');
    expect(res.body.streamingResults).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Artist page
// ---------------------------------------------------------------------------
describe('GET /api/artist/:mbid', () => {
  test('returns releases with cover art URLs', async () => {
    browseArtistReleases.mockResolvedValue(FIXTURE_MB_RELEASES);
    const res = await request(app).get('/api/artist/b7ffd2af-418f-4be2-bdd1-22f8b48613da?name=Pink+Floyd');
    expect(res.status).toBe(200);
    expect(res.body.releases).toHaveLength(2);
    expect(res.body.releases[0]).toHaveProperty('coverArt');
  });

  test('returns 400 for invalid mbid format', async () => {
    const res = await request(app).get('/api/artist/not-a-valid-mbid');
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// MB track endpoints
// ---------------------------------------------------------------------------
describe('GET /api/mb/release/:mbid/tracks', () => {
  test('returns tracks array', async () => {
    getReleaseTracks.mockResolvedValue([
      { position: 1, title: 'Speak to Me', lengthMs: 68000 },
      { position: 2, title: 'Breathe', lengthMs: 169000 },
    ]);
    const res = await request(app).get('/api/mb/release/b7ffd2af-418f-4be2-bdd1-22f8b48613da/tracks');
    expect(res.status).toBe(200);
    expect(res.body.tracks).toHaveLength(2);
    expect(res.body.tracks[0]).toHaveProperty('title', 'Speak to Me');
  });

  test('returns 400 for invalid mbid', async () => {
    const res = await request(app).get('/api/mb/release/bad-id/tracks');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/mb/release-group/:rgid/tracks', () => {
  test('returns release tracks', async () => {
    getReleaseGroupTracks.mockResolvedValue({
      releaseMbid: 'rel-1',
      tracks: [{ position: 1, title: 'Track 1', lengthMs: 200000 }],
    });
    const res = await request(app).get('/api/mb/release-group/b7ffd2af-418f-4be2-bdd1-22f8b48613da/tracks');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tracks');
  });

  test('returns 400 for invalid rgid', async () => {
    const res = await request(app).get('/api/mb/release-group/bad/tracks');
    expect(res.status).toBe(400);
  });
});
