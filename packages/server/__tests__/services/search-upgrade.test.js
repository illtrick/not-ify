'use strict';

const mockPrompt = jest.fn();
const mockParseTorrentBatch = jest.fn();
const mockCheckHealth = jest.fn();
jest.mock('../../src/services/llm', () => ({
  prompt: (...args) => mockPrompt(...args),
  parseTorrentBatch: (...args) => mockParseTorrentBatch(...args),
  checkHealth: (...args) => mockCheckHealth(...args),
}));

const mockSearchMusic = jest.fn();
jest.mock('../../src/services/search', () => {
  const original = jest.requireActual('../../src/services/search');
  return {
    ...original,
    searchMusic: (...args) => mockSearchMusic(...args),
  };
});

const mockSearchSolidTorrents = jest.fn();
jest.mock('../../src/services/solidtorrents', () => ({
  searchSolidTorrents: (...args) => mockSearchSolidTorrents(...args),
}));

const mockSearchSoulseekCascade = jest.fn();
const mockSlskHealth = jest.fn();
jest.mock('../../src/services/soulseek', () => ({
  searchSoulseekCascade: (...a) => mockSearchSoulseekCascade(...a),
  checkHealth: (...a) => mockSlskHealth(...a),
}));

// Import after mocks
let searchForUpgrade, generateSearchQueries;
beforeAll(() => {
  const mod = require('../../src/services/search');
  searchForUpgrade = mod.searchForUpgrade;
  generateSearchQueries = mod.generateSearchQueries;
});

describe('generateSearchQueries', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns LLM-generated queries when available', async () => {
    mockCheckHealth.mockResolvedValue(true);
    mockPrompt.mockResolvedValue({
      queries: [
        'boards of canada music has the right to children flac',
        'boards of canada discography flac',
        'BoC music right children lossless',
      ],
    });

    const queries = await generateSearchQueries('Boards of Canada', 'Music Has the Right to Children', 'flac');
    expect(queries.length).toBeGreaterThanOrEqual(3);
    expect(mockPrompt).toHaveBeenCalled();
  });

  test('falls back to programmatic queries when LLM unavailable', async () => {
    mockCheckHealth.mockResolvedValue(false);

    const queries = await generateSearchQueries('Radiohead', 'OK Computer', 'flac');
    expect(queries).toContain('Radiohead OK Computer flac');
    expect(queries.some(q => q.includes('discography'))).toBe(true);
    expect(queries.length).toBeGreaterThanOrEqual(3);
    expect(mockPrompt).not.toHaveBeenCalled();
  });

  test('fallback cleans noisy album names', async () => {
    mockCheckHealth.mockResolvedValue(false);

    const queries = await generateSearchQueries('Daft Punk', 'Random Access Memories (Deluxe Edition)', 'flac');
    expect(queries[0]).toBe('Daft Punk Random Access Memories flac');
    expect(queries[0]).not.toContain('Deluxe');
  });

  test('falls back when LLM returns invalid response', async () => {
    mockCheckHealth.mockResolvedValue(true);
    mockPrompt.mockResolvedValue(null);

    const queries = await generateSearchQueries('Artist', 'Album', 'flac');
    expect(queries.length).toBeGreaterThanOrEqual(2);
  });
});

describe('searchForUpgrade', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchSolidTorrents.mockResolvedValue([]);
    mockSlskHealth.mockResolvedValue(false); // off by default in existing tests
    mockSearchSoulseekCascade.mockResolvedValue({ strategy: 'none', responseCount: 0, fileCount: 0, responses: [] });
  });

  test('deduplicates results across multiple queries', async () => {
    mockCheckHealth.mockResolvedValue(false); // skip LLM
    const torrent = { id: '1', name: 'Artist - Album FLAC', magnetLink: 'magnet:?xt=urn:btih:abc', seeders: 10, leechers: 2, size: '500000000', source: 'apibay' };
    mockSearchMusic.mockResolvedValue([torrent]);

    const result = await searchForUpgrade({ artist: 'Artist', album: 'Album', currentQuality: 'unknown' });
    // Called with 3+ fallback queries but same result deduped
    expect(mockSearchMusic).toHaveBeenCalledTimes(3); // 3 fallback queries (no diacritics, short query not triggered)
    expect(result).not.toBeNull();
    expect(result.magnetLink).toBe('magnet:?xt=urn:btih:abc');
  });

  test('cleans noisy album names in fallback queries', async () => {
    mockCheckHealth.mockResolvedValue(false);
    mockSearchMusic.mockResolvedValue([]);

    await searchForUpgrade({ artist: 'Hans Zimmer', album: 'Interstellar (Original Motion Picture Soundtrack)', currentQuality: 'unknown' });
    // First query should use the cleaned album name
    const firstCall = mockSearchMusic.mock.calls[0][0];
    expect(firstCall).toBe('Hans Zimmer Interstellar flac');
    expect(firstCall).not.toContain('Soundtrack');
  });

  test('fallback generates at least 3 queries', async () => {
    mockCheckHealth.mockResolvedValue(false);
    mockSearchMusic.mockResolvedValue([]);

    await searchForUpgrade({ artist: 'Radiohead', album: 'OK Computer', currentQuality: 'unknown' });
    expect(mockSearchMusic.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  test('returns null when no results found', async () => {
    mockCheckHealth.mockResolvedValue(false);
    mockSearchMusic.mockResolvedValue([]);

    const result = await searchForUpgrade({ artist: 'Unknown', album: 'Nothing', currentQuality: 'unknown' });
    expect(result).toBeNull();
  });

  test('ranks results by token match + quality + seeders', async () => {
    mockCheckHealth.mockResolvedValue(false);
    const torrents = [
      { id: '1', name: 'Artist Discography MP3', magnetLink: 'magnet:1', seeders: 100, leechers: 5, size: '1000000000', source: 'apibay' },
      { id: '2', name: 'Artist - Album [FLAC]', magnetLink: 'magnet:2', seeders: 20, leechers: 2, size: '500000000', source: 'apibay' },
    ];
    mockSearchMusic.mockResolvedValue(torrents);

    const result = await searchForUpgrade({ artist: 'Artist', album: 'Album', currentQuality: 'unknown' });
    // FLAC album match should beat MP3 discography despite fewer seeders
    expect(result.magnetLink).toBe('magnet:2');
  });

  test('includes Soulseek results when torrents find nothing', async () => {
    mockCheckHealth.mockResolvedValue(false);
    mockSearchMusic.mockResolvedValue([]);
    mockSearchSolidTorrents.mockResolvedValue([]);
    mockSlskHealth.mockResolvedValue(true);
    mockSearchSoulseekCascade.mockResolvedValue({
      strategy: 'artist-only',
      responseCount: 5,
      fileCount: 42,
      responses: [{
        username: 'musicfan99',
        hasFreeSlot: true,
        speed: 5000000,
        files: [
          { filename: '\\\\music\\\\Artist\\\\Album\\\\01 Track.flac', size: 30000000, bitRate: 1411, sampleRate: 44100, bitDepth: 16 },
          { filename: '\\\\music\\\\Artist\\\\Album\\\\02 Track.flac', size: 28000000, bitRate: 1411, sampleRate: 44100, bitDepth: 16 },
          { filename: '\\\\music\\\\Artist\\\\Album\\\\03 Track.flac', size: 32000000, bitRate: 1411, sampleRate: 44100, bitDepth: 16 },
        ],
      }],
    });

    const result = await searchForUpgrade({ artist: 'Artist', album: 'Album' });
    expect(result).not.toBeNull();
    expect(result.source).toBe('soulseek');
    expect(result.soulseekUser).toBe('musicfan99');
    expect(result.files.length).toBe(3);
  });

  test('skips Soulseek when slskd is unhealthy', async () => {
    mockCheckHealth.mockResolvedValue(false);
    mockSearchMusic.mockResolvedValue([]);
    mockSearchSolidTorrents.mockResolvedValue([]);
    mockSlskHealth.mockResolvedValue(false);

    const result = await searchForUpgrade({ artist: 'Artist', album: 'Album' });
    expect(result).toBeNull();
    expect(mockSearchSoulseekCascade).not.toHaveBeenCalled();
  });
});
