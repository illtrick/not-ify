'use strict';

// Suite — GET /api/album/:id canonical album detail endpoint

jest.mock('fs', () => {
  const { fs: memfs } = require('memfs');
  return memfs;
});

jest.mock('../../src/services/search', () => ({ searchMusic: jest.fn().mockResolvedValue([]) }));
jest.mock('../../src/services/musicbrainz', () => ({
  searchReleases: jest.fn().mockResolvedValue([]),
  searchArtists: jest.fn().mockResolvedValue([]),
  browseArtistReleases: jest.fn().mockResolvedValue([]),
  getReleaseTracks: jest.fn().mockResolvedValue([]),
  getReleaseGroupTracks: jest.fn().mockResolvedValue({ releaseMbid: null, tracks: [] }),
}));
jest.mock('../../src/services/youtube', () => ({
  searchYouTube: jest.fn().mockResolvedValue([]),
  searchSoundCloud: jest.fn().mockResolvedValue([]),
  getStreamUrl: jest.fn(),
}));
jest.mock('../../src/services/llm', () => ({
  getCachedParse: jest.fn().mockReturnValue(null),
  parseTorrentNamesAsync: jest.fn(),
  checkHealth: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../src/services/lastfm', () => ({}));
jest.mock('../../src/services/realdebrid', () => ({}));
jest.mock('../../src/services/migrate', () => ({ migrate: jest.fn() }));
jest.mock('../../src/services/job-queue', () => ({
  enqueue: jest.fn(), dequeue: jest.fn(), complete: jest.fn(), fail: jest.fn(),
  skip: jest.fn(), getByType: jest.fn().mockReturnValue([]),
  getByStatus: jest.fn().mockReturnValue([]),
  getAll: jest.fn().mockReturnValue([]), getStats: jest.fn().mockReturnValue({}),
}));

jest.mock('../../src/services/db', () => ({
  getDb: jest.fn(),
  isValidUser: jest.fn().mockReturnValue(true),
  isSetupComplete: jest.fn().mockReturnValue(true),
  getDefaultUserId: jest.fn().mockReturnValue('default'),
  getUsers: jest.fn().mockReturnValue([]),
  getRecentlyPlayed: jest.fn().mockReturnValue([]),
  addRecentlyPlayed: jest.fn().mockReturnValue([]),
  bulkSetRecentlyPlayed: jest.fn().mockReturnValue([]),
  getLastfmConfig: jest.fn().mockReturnValue({}),
  saveLastfmConfig: jest.fn(),
  clearLastfmConfig: jest.fn(),
  getScrobbleQueue: jest.fn().mockReturnValue([]),
  addToScrobbleQueue: jest.fn(),
  removeFromScrobbleQueue: jest.fn(),
  getAllUsersWithScrobbleQueue: jest.fn().mockReturnValue([]),
  getGlobalSetting: jest.fn(),
  setGlobalSetting: jest.fn(),
  getUserSetting: jest.fn(),
  setUserSetting: jest.fn(),
  getAllUserSettings: jest.fn().mockReturnValue({}),
  getSearchHistory: jest.fn().mockReturnValue([]),
  addSearchHistory: jest.fn(),
  removeSearchHistory: jest.fn(),
  clearSearchHistory: jest.fn(),
  getFavorites: jest.fn().mockReturnValue([]),
  addFavorite: jest.fn(),
  removeFavorite: jest.fn(),
  isFavorite: jest.fn().mockReturnValue(false),
  getUserSession: jest.fn().mockReturnValue({ queue: [], state: {} }),
  saveUserSession: jest.fn(),
  upsertTrack: jest.fn(),
  getTrackById: jest.fn().mockReturnValue(null),
  getAllTracks: jest.fn().mockReturnValue([]),
  getTracksByAlbum: jest.fn().mockReturnValue([]),
  removeTrackByFilepath: jest.fn(),
  removeTrackById: jest.fn(),
  syncAlbumTracks: jest.fn(),
  pruneDeletedTracks: jest.fn(),
  // Album detail functions
  getAlbumByAnyId: jest.fn().mockReturnValue(null),
  getAlbumWithTracks: jest.fn().mockReturnValue(null),
  getAllAlbumsWithTracks: jest.fn().mockReturnValue([]),
  updateAlbumCoverArt: jest.fn(),
}));

const { vol } = require('memfs');
const request = require('supertest');
const app = require('../../src/index');
const db = require('../../src/services/db');

beforeEach(() => {
  vol.reset();
  vol.mkdirSync('/app/music', { recursive: true });
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ALBUM_ROW = { id: 42 };

const ALBUM_DATA = {
  id: 42,
  title: 'Dark Side of the Moon',
  album_artist: 'Pink Floyd',
  year: 1973,
  mbid: 'rel-abc',
  rgid: 'rg-123',
  cover_art_url: '/api/cover/rg/rg-123',
  compilation: 0,
  tracks: [
    {
      id: 'track-1',
      title: 'Speak to Me',
      artist: 'Pink Floyd',
      track_number: 1,
      disc_number: 1,
      duration: 68,
      mbid: 'tm-1',
      file: null,
    },
    {
      id: 'track-2',
      title: 'Breathe',
      artist: 'Pink Floyd',
      track_number: 2,
      disc_number: 1,
      duration: 169,
      mbid: 'tm-2',
      file: null,
    },
  ],
};

const ALBUM_DATA_WITH_FILES = {
  ...ALBUM_DATA,
  tracks: ALBUM_DATA.tracks.map(t => ({
    ...t,
    file: {
      filepath: `/app/music/Pink Floyd/Dark Side of the Moon/${t.title}.flac`,
      format: 'flac',
      bitrate: null,
      file_size: 30000000,
      file_duration: t.duration,
      scan_status: 'clean',
    },
  })),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/album/:id', () => {
  test('returns 404 for unknown ID', async () => {
    db.getAlbumByAnyId.mockReturnValue(null);

    const res = await request(app).get('/api/album/99999');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  test('returns 200 with correct album shape for a valid ID', async () => {
    db.getAlbumByAnyId.mockReturnValue(ALBUM_ROW);
    db.getAlbumWithTracks.mockReturnValue(ALBUM_DATA);

    const res = await request(app).get('/api/album/42');
    expect(res.status).toBe(200);

    const body = res.body;
    expect(body.id).toBe(42);
    expect(body.artist).toBe('Pink Floyd');
    expect(body.album).toBe('Dark Side of the Moon');
    expect(body.year).toBe(1973);
    expect(body.rgid).toBe('rg-123');
    expect(body.mbid).toBe('rel-abc');
    expect(body.coverArt).toBe('/api/cover/rg/rg-123');
    expect(body.trackCount).toBe(2);
    expect(body.duration).toBe(68 + 169);
    expect(body.inLibrary).toBe(false);
    expect(body.compilation).toBe(false);
    expect(body.tracks).toHaveLength(2);

    // Check track shape
    const t = body.tracks[0];
    expect(t.id).toBe('track-1');
    expect(t.title).toBe('Speak to Me');
    expect(t.trackNumber).toBe(1);
    expect(t.discNumber).toBe(1);
    expect(t.file).toBeNull();
  });

  test('returns 200 when resolved by rgid', async () => {
    db.getAlbumByAnyId.mockReturnValue(ALBUM_ROW);
    db.getAlbumWithTracks.mockReturnValue(ALBUM_DATA);

    const res = await request(app).get('/api/album/rg-123');
    expect(res.status).toBe(200);
    expect(res.body.rgid).toBe('rg-123');
    expect(db.getAlbumByAnyId).toHaveBeenCalledWith('rg-123');
  });

  test('inLibrary is true when tracks have filepaths', async () => {
    db.getAlbumByAnyId.mockReturnValue(ALBUM_ROW);
    db.getAlbumWithTracks.mockReturnValue(ALBUM_DATA_WITH_FILES);

    const res = await request(app).get('/api/album/42');
    expect(res.status).toBe(200);
    expect(res.body.inLibrary).toBe(true);

    // Check file object shape
    const t = res.body.tracks[0];
    expect(t.file).not.toBeNull();
    expect(t.file.format).toBe('flac');
    expect(t.file.filepath).toContain('Speak to Me');
    expect(t.file.fileSize).toBe(30000000);
  });
});
