'use strict';

// QualityUpgrader uses pure dependency injection — no real DB, no real FS.
// All dependencies are jest mock functions passed via constructor.

const QualityUpgrader = require('../../src/services/quality-upgrader');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTrack(overrides = {}) {
  return {
    artist: 'Test Artist',
    album: 'Test Album',
    title: 'Track 1',
    format: 'mp3',
    path: '/music/Test Artist/Test Album/01 Track 1.mp3',
    ...overrides,
  };
}

function makeJobQueue(overrides = {}) {
  return {
    enqueue: jest.fn().mockReturnValue(1),
    dequeue: jest.fn().mockReturnValue(null),
    complete: jest.fn(),
    fail: jest.fn(),
    getByType: jest.fn().mockReturnValue([]),
    getByStatus: jest.fn().mockReturnValue([]),
    ...overrides,
  };
}

function makeLibrary(tracks = []) {
  return jest.fn().mockResolvedValue(tracks);
}

function makeSearch(result = null) {
  return jest.fn().mockResolvedValue(result);
}

function makeDownloader(overrides = {}) {
  return {
    download: jest.fn().mockResolvedValue({ path: '/music/downloaded.flac' }),
    ...overrides,
  };
}

function makeRd(overrides = {}) {
  return {
    resolve: jest.fn().mockResolvedValue({ files: [] }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// scanForUpgrades
// ---------------------------------------------------------------------------

describe('QualityUpgrader.scanForUpgrades', () => {
  it('identifies MP3 tracks that could be FLAC', async () => {
    const tracks = [
      makeTrack({ artist: 'Artist A', album: 'Album 1', format: 'mp3' }),
      makeTrack({ artist: 'Artist A', album: 'Album 1', title: 'Track 2', format: 'mp3' }),
    ];
    const jobQueue = makeJobQueue();
    const upgrader = new QualityUpgrader({
      jobQueue,
      library: makeLibrary(tracks),
      search: makeSearch(),
      downloader: makeDownloader(),
      rd: makeRd(),
    });

    const albums = await upgrader.scanForUpgrades('flac');

    expect(albums.length).toBe(1);
    expect(albums[0].artist).toBe('Artist A');
    expect(albums[0].album).toBe('Album 1');
    expect(albums[0].currentQuality).toBe('mp3');
  });

  it('does not flag FLAC tracks for upgrade', async () => {
    const tracks = [
      makeTrack({ format: 'flac' }),
      makeTrack({ title: 'Track 2', format: 'flac' }),
    ];
    const upgrader = new QualityUpgrader({
      jobQueue: makeJobQueue(),
      library: makeLibrary(tracks),
      search: makeSearch(),
      downloader: makeDownloader(),
      rd: makeRd(),
    });

    const albums = await upgrader.scanForUpgrades('flac');

    expect(albums.length).toBe(0);
  });

  it('does not flag albums already at the target quality', async () => {
    const tracks = [
      makeTrack({ format: 'flac' }),
    ];
    const upgrader = new QualityUpgrader({
      jobQueue: makeJobQueue(),
      library: makeLibrary(tracks),
      search: makeSearch(),
      downloader: makeDownloader(),
      rd: makeRd(),
    });

    const albums = await upgrader.scanForUpgrades('flac');

    expect(albums.length).toBe(0);
  });

  it('does not flag albums above the target quality (e.g. wav when target is mp3)', async () => {
    const tracks = [
      makeTrack({ format: 'wav' }),
    ];
    const upgrader = new QualityUpgrader({
      jobQueue: makeJobQueue(),
      library: makeLibrary(tracks),
      search: makeSearch(),
      downloader: makeDownloader(),
      rd: makeRd(),
    });

    // wav (rank 4) >= mp3 (rank 1) — should not be flagged
    const albums = await upgrader.scanForUpgrades('mp3');

    expect(albums.length).toBe(0);
  });

  it('uses the best quality track in an album to determine current quality', async () => {
    // Mixed album: has one FLAC already — should not be flagged
    const tracks = [
      makeTrack({ format: 'mp3' }),
      makeTrack({ title: 'Track 2', format: 'flac' }),
    ];
    const upgrader = new QualityUpgrader({
      jobQueue: makeJobQueue(),
      library: makeLibrary(tracks),
      search: makeSearch(),
      downloader: makeDownloader(),
      rd: makeRd(),
    });

    const albums = await upgrader.scanForUpgrades('flac');

    expect(albums.length).toBe(0);
  });

  it('enqueues an upgrade job for each album below target quality', async () => {
    const tracks = [
      makeTrack({ artist: 'Artist A', album: 'Album 1', format: 'mp3' }),
      makeTrack({ artist: 'Artist B', album: 'Album 2', format: 'ogg' }),
    ];
    const jobQueue = makeJobQueue();
    const upgrader = new QualityUpgrader({
      jobQueue,
      library: makeLibrary(tracks),
      search: makeSearch(),
      downloader: makeDownloader(),
      rd: makeRd(),
    });

    await upgrader.scanForUpgrades('flac');

    expect(jobQueue.enqueue).toHaveBeenCalledTimes(2);
    expect(jobQueue.enqueue).toHaveBeenCalledWith(
      'upgrade',
      expect.objectContaining({ artist: 'Artist A', album: 'Album 1' }),
      expect.anything()
    );
    expect(jobQueue.enqueue).toHaveBeenCalledWith(
      'upgrade',
      expect.objectContaining({ artist: 'Artist B', album: 'Album 2' }),
      expect.anything()
    );
  });

  it('uses dedupeKey to prevent duplicate upgrade jobs', async () => {
    const tracks = [makeTrack({ format: 'mp3' })];
    const jobQueue = makeJobQueue();
    const upgrader = new QualityUpgrader({
      jobQueue,
      library: makeLibrary(tracks),
      search: makeSearch(),
      downloader: makeDownloader(),
      rd: makeRd(),
    });

    await upgrader.scanForUpgrades('flac');

    const call = jobQueue.enqueue.mock.calls[0];
    expect(call[2]).toEqual(expect.objectContaining({ dedupeKey: expect.any(String) }));
  });

  it('groups tracks from the same album together', async () => {
    const tracks = [
      makeTrack({ artist: 'A', album: 'X', title: 'T1', format: 'mp3' }),
      makeTrack({ artist: 'A', album: 'X', title: 'T2', format: 'mp3' }),
      makeTrack({ artist: 'B', album: 'Y', title: 'T1', format: 'mp3' }),
    ];
    const jobQueue = makeJobQueue();
    const upgrader = new QualityUpgrader({
      jobQueue,
      library: makeLibrary(tracks),
      search: makeSearch(),
      downloader: makeDownloader(),
      rd: makeRd(),
    });

    const albums = await upgrader.scanForUpgrades('flac');

    expect(albums.length).toBe(2);
    // Only 2 enqueue calls, one per album
    expect(jobQueue.enqueue).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// findBetterSource
// ---------------------------------------------------------------------------

describe('QualityUpgrader.findBetterSource', () => {
  it('searches torrent sources for better quality', async () => {
    const search = makeSearch({ magnetLink: 'magnet:?xt=urn:btih:abc', sources: [] });
    const upgrader = new QualityUpgrader({
      jobQueue: makeJobQueue(),
      library: makeLibrary([]),
      search,
      downloader: makeDownloader(),
      rd: makeRd(),
    });

    await upgrader.findBetterSource('Artist A', 'Album 1', 'mp3');

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ artist: 'Artist A', album: 'Album 1' })
    );
  });

  it('returns result with magnetLink when better source found', async () => {
    const searchResult = { magnetLink: 'magnet:?xt=urn:btih:abc123', sources: ['src1'] };
    const upgrader = new QualityUpgrader({
      jobQueue: makeJobQueue(),
      library: makeLibrary([]),
      search: makeSearch(searchResult),
      downloader: makeDownloader(),
      rd: makeRd(),
    });

    const result = await upgrader.findBetterSource('Artist A', 'Album 1', 'mp3');

    expect(result).not.toBeNull();
    expect(result.magnetLink).toBe('magnet:?xt=urn:btih:abc123');
  });

  it('returns null when no better source is found', async () => {
    const upgrader = new QualityUpgrader({
      jobQueue: makeJobQueue(),
      library: makeLibrary([]),
      search: makeSearch(null),
      downloader: makeDownloader(),
      rd: makeRd(),
    });

    const result = await upgrader.findBetterSource('Artist A', 'Album 1', 'mp3');

    expect(result).toBeNull();
  });

  it('returns null when search returns empty result', async () => {
    const upgrader = new QualityUpgrader({
      jobQueue: makeJobQueue(),
      library: makeLibrary([]),
      search: makeSearch({}),
      downloader: makeDownloader(),
      rd: makeRd(),
    });

    const result = await upgrader.findBetterSource('Artist A', 'Album 1', 'mp3');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// handleDiscographyDownload
// ---------------------------------------------------------------------------

describe('QualityUpgrader.handleDiscographyDownload', () => {
  it('enqueues a download job for the discography torrent', async () => {
    const jobQueue = makeJobQueue();
    const upgrader = new QualityUpgrader({
      jobQueue,
      library: makeLibrary([]),
      search: makeSearch(),
      downloader: makeDownloader(),
      rd: makeRd(),
    });

    await upgrader.handleDiscographyDownload('magnet:?xt=urn:btih:disc123', 'Artist A', 'Album 1');

    expect(jobQueue.enqueue).toHaveBeenCalledWith(
      'download',
      expect.objectContaining({
        magnetLink: 'magnet:?xt=urn:btih:disc123',
        targetArtist: 'Artist A',
        targetAlbum: 'Album 1',
        isDiscography: true,
      }),
      expect.anything()
    );
  });

  it('returns the enqueued job ID', async () => {
    const jobQueue = makeJobQueue({ enqueue: jest.fn().mockReturnValue(42) });
    const upgrader = new QualityUpgrader({
      jobQueue,
      library: makeLibrary([]),
      search: makeSearch(),
      downloader: makeDownloader(),
      rd: makeRd(),
    });

    const jobId = await upgrader.handleDiscographyDownload(
      'magnet:?xt=urn:btih:disc123',
      'Artist A',
      'Album 1'
    );

    expect(jobId).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// isIdle
// ---------------------------------------------------------------------------

describe('QualityUpgrader.isIdle', () => {
  it('returns true when no active download jobs exist', () => {
    const jobQueue = makeJobQueue({ getByStatus: jest.fn().mockReturnValue([]) });
    const upgrader = new QualityUpgrader({
      jobQueue,
      library: makeLibrary([]),
      search: makeSearch(),
      downloader: makeDownloader(),
      rd: makeRd(),
    });

    expect(upgrader.isIdle()).toBe(true);
  });

  it('returns false when active download jobs exist', () => {
    const activeJobs = [{ id: 1, type: 'download', status: 'active' }];
    const jobQueue = makeJobQueue({
      getByStatus: jest.fn().mockReturnValue(activeJobs),
    });
    const upgrader = new QualityUpgrader({
      jobQueue,
      library: makeLibrary([]),
      search: makeSearch(),
      downloader: makeDownloader(),
      rd: makeRd(),
    });

    expect(upgrader.isIdle()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tick — idle scheduling
// ---------------------------------------------------------------------------

describe('QualityUpgrader.tick', () => {
  it('does not process upgrade jobs when system is not idle', async () => {
    const activeJobs = [{ id: 1, type: 'download', status: 'active' }];
    const jobQueue = makeJobQueue({
      getByStatus: jest.fn().mockReturnValue(activeJobs),
      dequeue: jest.fn().mockReturnValue(null),
    });
    const upgrader = new QualityUpgrader({
      jobQueue,
      library: makeLibrary([]),
      search: makeSearch(),
      downloader: makeDownloader(),
      rd: makeRd(),
    });

    await upgrader.tick();

    // dequeue should not have been called for upgrade jobs when busy
    expect(jobQueue.dequeue).not.toHaveBeenCalled();
  });

  it('dequeues and processes an upgrade job when idle', async () => {
    const upgradeJob = {
      id: 10,
      type: 'upgrade',
      status: 'active',
      payload: JSON.stringify({ artist: 'Artist A', album: 'Album 1', currentQuality: 'mp3' }),
    };
    const jobQueue = makeJobQueue({
      getByStatus: jest.fn().mockReturnValue([]), // no active downloads => idle
      dequeue: jest.fn().mockReturnValueOnce(upgradeJob).mockReturnValue(null),
    });
    const search = makeSearch({ magnetLink: 'magnet:?xt=urn:btih:xyz', sources: [] });
    const upgrader = new QualityUpgrader({
      jobQueue,
      library: makeLibrary([]),
      search,
      downloader: makeDownloader(),
      rd: makeRd(),
    });

    await upgrader.tick();

    expect(jobQueue.dequeue).toHaveBeenCalledWith('upgrade');
  });

  it('marks job complete when better source is found and download queued', async () => {
    const upgradeJob = {
      id: 10,
      type: 'upgrade',
      status: 'active',
      payload: JSON.stringify({ artist: 'Artist A', album: 'Album 1', currentQuality: 'mp3' }),
    };
    const jobQueue = makeJobQueue({
      getByStatus: jest.fn().mockReturnValue([]),
      dequeue: jest.fn().mockReturnValueOnce(upgradeJob).mockReturnValue(null),
      enqueue: jest.fn().mockReturnValue(99),
    });
    const search = makeSearch({ magnetLink: 'magnet:?xt=urn:btih:xyz', sources: [] });
    const upgrader = new QualityUpgrader({
      jobQueue,
      library: makeLibrary([]),
      search,
      downloader: makeDownloader(),
      rd: makeRd(),
    });

    await upgrader.tick();

    expect(jobQueue.complete).toHaveBeenCalledWith(10, expect.objectContaining({ downloadJobId: 99 }));
  });

  it('marks job complete with no source when none is found', async () => {
    const upgradeJob = {
      id: 10,
      type: 'upgrade',
      status: 'active',
      payload: JSON.stringify({ artist: 'Artist A', album: 'Album 1', currentQuality: 'mp3' }),
    };
    const jobQueue = makeJobQueue({
      getByStatus: jest.fn().mockReturnValue([]),
      dequeue: jest.fn().mockReturnValueOnce(upgradeJob).mockReturnValue(null),
    });
    const upgrader = new QualityUpgrader({
      jobQueue,
      library: makeLibrary([]),
      search: makeSearch(null),
      downloader: makeDownloader(),
      rd: makeRd(),
    });

    await upgrader.tick();

    expect(jobQueue.complete).toHaveBeenCalledWith(10, expect.objectContaining({ noSource: true }));
  });

  it('does nothing when upgrade queue is empty', async () => {
    const jobQueue = makeJobQueue({
      getByStatus: jest.fn().mockReturnValue([]),
      dequeue: jest.fn().mockReturnValue(null),
    });
    const upgrader = new QualityUpgrader({
      jobQueue,
      library: makeLibrary([]),
      search: makeSearch(),
      downloader: makeDownloader(),
      rd: makeRd(),
    });

    await upgrader.tick();

    expect(jobQueue.complete).not.toHaveBeenCalled();
    expect(jobQueue.fail).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// upgradeAlbum — manual trigger, bypasses idle check
// ---------------------------------------------------------------------------

describe('QualityUpgrader.upgradeAlbum', () => {
  it('enqueues an upgrade job immediately regardless of idle state', async () => {
    // Simulate a busy system (active downloads)
    const activeJobs = [{ id: 1, type: 'download', status: 'active' }];
    const jobQueue = makeJobQueue({
      getByStatus: jest.fn().mockReturnValue(activeJobs),
      enqueue: jest.fn().mockReturnValue(5),
    });
    const upgrader = new QualityUpgrader({
      jobQueue,
      library: makeLibrary([]),
      search: makeSearch(),
      downloader: makeDownloader(),
      rd: makeRd(),
    });

    const jobId = await upgrader.upgradeAlbum('Artist A', 'Album 1');

    expect(jobQueue.enqueue).toHaveBeenCalledWith(
      'upgrade',
      expect.objectContaining({ artist: 'Artist A', album: 'Album 1' }),
      expect.anything()
    );
    expect(jobId).toBe(5);
  });

  it('enqueues with elevated priority compared to background scans', async () => {
    const jobQueue = makeJobQueue();
    const upgrader = new QualityUpgrader({
      jobQueue,
      library: makeLibrary([]),
      search: makeSearch(),
      downloader: makeDownloader(),
      rd: makeRd(),
    });

    await upgrader.upgradeAlbum('Artist A', 'Album 1');

    const call = jobQueue.enqueue.mock.calls[0];
    const opts = call[2];
    // Manual trigger should be higher priority than background scan (priority > 0)
    expect(opts.priority).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// QUALITY_RANK — exported constant
// ---------------------------------------------------------------------------

describe('QUALITY_RANK', () => {
  it('is exported and contains expected format rankings', () => {
    const { QUALITY_RANK } = require('../../src/services/quality-upgrader');
    expect(QUALITY_RANK.flac).toBe(5);
    expect(QUALITY_RANK.mp3).toBe(1);
    expect(QUALITY_RANK.wav).toBe(4);
    expect(QUALITY_RANK.m4a).toBe(3);
  });
});
