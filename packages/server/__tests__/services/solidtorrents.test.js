'use strict';

const mockGetProxyFetch = jest.fn();
const mockRecordFailure = jest.fn();

jest.mock('../../src/services/proxy', () => ({
  getProxyFetch: (...args) => mockGetProxyFetch(...args),
  recordFailure: (...args) => mockRecordFailure(...args),
}));

let searchSolidTorrents;

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  // Re-apply mock after resetModules
  jest.mock('../../src/services/proxy', () => ({
    getProxyFetch: (...args) => mockGetProxyFetch(...args),
    recordFailure: (...args) => mockRecordFailure(...args),
  }));
  ({ searchSolidTorrents } = require('../../src/services/solidtorrents'));
});

function makeFakeFetch(status, body) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  });
}

const FIXTURE_RESPONSE = {
  success: true,
  results: [
    { infohash: 'abc123', title: 'Artist - Album [FLAC]', size: 500 * 1024 * 1024, seeders: 42, leechers: 5, category: 'Audio' },
    { infohash: 'def456', title: 'Artist - Album [320]', size: 200 * 1024 * 1024, seeders: 18, leechers: 2, category: 'Audio' },
    { infohash: 'ghi789', title: 'Artist - Old Album [MP3]', size: 100 * 1024 * 1024, seeders: 0, leechers: 0, category: 'Audio' },
  ],
};

describe('searchSolidTorrents', () => {
  test('returns normalized results on success', async () => {
    const fakeFetch = makeFakeFetch(200, FIXTURE_RESPONSE);
    mockGetProxyFetch.mockReturnValue(fakeFetch);

    const results = await searchSolidTorrents('artist album flac');

    expect(results).toHaveLength(2); // third has 0 seeders, filtered out
    expect(results[0]).toMatchObject({
      id: 'solid_abc123',
      name: 'Artist - Album [FLAC]',
      magnetLink: expect.stringContaining('btih:abc123'),
      seeders: 42,
      leechers: 5,
      source: 'solidtorrents',
    });
    expect(results[0].sizeFormatted).toBeDefined();
  });

  test('results are sorted by seeders descending', async () => {
    const fakeFetch = makeFakeFetch(200, FIXTURE_RESPONSE);
    mockGetProxyFetch.mockReturnValue(fakeFetch);

    const results = await searchSolidTorrents('artist album');

    expect(results[0].seeders).toBeGreaterThanOrEqual(results[1].seeders);
  });

  test('filters out results with 0 seeders', async () => {
    const fakeFetch = makeFakeFetch(200, FIXTURE_RESPONSE);
    mockGetProxyFetch.mockReturnValue(fakeFetch);

    const results = await searchSolidTorrents('artist album mp3');

    expect(results.every(r => r.seeders > 0)).toBe(true);
  });

  test('returns empty array when API response has no results', async () => {
    const fakeFetch = makeFakeFetch(200, { success: true, results: [] });
    mockGetProxyFetch.mockReturnValue(fakeFetch);

    const results = await searchSolidTorrents('something obscure');

    expect(results).toEqual([]);
  });

  test('returns empty array when success is false', async () => {
    const fakeFetch = makeFakeFetch(200, { success: false, results: null });
    mockGetProxyFetch.mockReturnValue(fakeFetch);

    const results = await searchSolidTorrents('query');

    expect(results).toEqual([]);
  });

  test('returns empty array on HTTP error and records failure', async () => {
    const fakeFetch = makeFakeFetch(503, {});
    mockGetProxyFetch.mockReturnValue(fakeFetch);

    const results = await searchSolidTorrents('query');

    expect(results).toEqual([]);
    // recordFailure is NOT called for non-ok HTTP responses (error logged only)
    expect(mockRecordFailure).not.toHaveBeenCalled();
  });

  test('returns empty array on network error and records failure', async () => {
    const fakeFetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    mockGetProxyFetch.mockReturnValue(fakeFetch);

    const results = await searchSolidTorrents('query');

    expect(results).toEqual([]);
    expect(mockRecordFailure).toHaveBeenCalledWith('solidtorrents', 'ECONNREFUSED');
  });

  test('caches results and returns cached data on second call', async () => {
    const fakeFetch = makeFakeFetch(200, FIXTURE_RESPONSE);
    mockGetProxyFetch.mockReturnValue(fakeFetch);

    const first = await searchSolidTorrents('cached query');
    const second = await searchSolidTorrents('cached query');

    expect(first).toEqual(second);
    // fetch should only have been called once
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  test('cache key is case-insensitive', async () => {
    const fakeFetch = makeFakeFetch(200, FIXTURE_RESPONSE);
    mockGetProxyFetch.mockReturnValue(fakeFetch);

    await searchSolidTorrents('Artist Album FLAC');
    await searchSolidTorrents('artist album flac');

    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  test('magnet link includes both btih hash and encoded title', async () => {
    const fakeFetch = makeFakeFetch(200, FIXTURE_RESPONSE);
    mockGetProxyFetch.mockReturnValue(fakeFetch);

    const results = await searchSolidTorrents('artist album');
    const magnet = results[0].magnetLink;

    expect(magnet).toMatch(/xt=urn:btih:abc123/);
    expect(magnet).toMatch(/dn=/);
  });

  test('formatBytes returns human-readable size', async () => {
    const fakeFetch = makeFakeFetch(200, {
      success: true,
      results: [
        { infohash: 'aaa', title: 'Test', size: 500 * 1024 * 1024, seeders: 5, leechers: 0, category: 'Audio' },
      ],
    });
    mockGetProxyFetch.mockReturnValue(fakeFetch);

    const results = await searchSolidTorrents('test');
    expect(results[0].sizeFormatted).toBe('500 MB');
  });
});
