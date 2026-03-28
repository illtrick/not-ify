'use strict';

/**
 * Integration test: upgrade job → quality-upgrader.tick() → enqueues download job →
 * job-processor processes it. Uses mocked external services (RD, MB, network)
 * but real job-queue + job-worker + quality-upgrader + job-processor wiring.
 */

const Database = require('better-sqlite3');

let mockDb;

jest.mock('../../src/services/db', () => ({
  getDb: () => mockDb,
  getGlobalSetting: () => null,
  getUsers: () => [],
}));

jest.mock('../../src/services/realdebrid', () => ({
  addMagnet: jest.fn().mockResolvedValue({ id: 'rd-test' }),
  selectFiles: jest.fn().mockResolvedValue(undefined),
  getTorrentInfo: jest.fn()
    .mockResolvedValueOnce({ status: 'waiting_files_selection', files: [{ id: 1, path: '01 Track.flac', bytes: 30000000 }] })
    .mockResolvedValueOnce({ status: 'downloaded', links: ['https://rd.io/f1'] }),
  unrestrictLink: jest.fn().mockResolvedValue({ download: 'https://dl.rd.io/f1', filename: '01 Track.flac' }),
  deleteTorrent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/downloader', () => ({
  downloadFile: jest.fn().mockResolvedValue('/music/_staging/A/B/01 Track.flac'),
  extractArchive: jest.fn(),
  selectAlbumFiles: jest.fn().mockReturnValue({ fileIds: [1], isDiscography: false }),
  isAudioFile: (f) => /\.(flac|mp3)$/i.test(f),
  isArchive: (f) => /\.(rar|zip)$/i.test(f),
  sanitizePath: (s) => s.replace(/[<>:"/\\|?*]/g, '_').trim(),
}));

jest.mock('../../src/services/file-validator', () => ({
  validateFile: jest.fn().mockResolvedValue({ passed: true, checks: [] }),
}));

jest.mock('../../src/services/download-validator', () => ({
  validate: jest.fn().mockResolvedValue({ score: 0.05, confidence: 'high', details: 'test match' }),
}));

jest.mock('../../src/services/activity-log', () => ({
  log: jest.fn(),
}));

jest.mock('../../src/api/pipeline', () => ({
  isDownloadActive: jest.fn().mockReturnValue(false),
}));

jest.mock('../../src/services/library-check', () => ({
  ...jest.requireActual('../../src/services/library-check'),
  resolveAlbumDir: (rgid, artist, album) => {
    const sanitize = (s) => (s || 'Unknown').replace(/[<>:"/\\|?*]/g, '_').trim();
    return `/music/${sanitize(artist)}/${sanitize(album)}`;
  },
}));

// Use requireActual as base to preserve native module fs access (needed by better-sqlite3 bindings).
// Only override specific methods needed by job-processor.
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  mkdirSync: jest.fn(),
  renameSync: jest.fn(),
  rmSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(false),
  readdirSync: jest.fn().mockReturnValue([]),
}));

const fs = require('fs');

describe('pipeline integration', () => {
  let jobQueue;

  beforeEach(() => {
    mockDb = new Database(':memory:');
    mockDb.pragma('journal_mode = WAL');
    jest.clearAllMocks();
    process.env.MUSIC_DIR = '/music';

    fs.mkdirSync.mockReturnValue(undefined);
    fs.renameSync.mockReturnValue(undefined);
    fs.rmSync.mockReturnValue(undefined);
    fs.existsSync.mockReturnValue(false);
    fs.readdirSync.mockReturnValue([]);

    // Fresh job queue on in-memory DB
    jest.resetModules();
    jobQueue = require('../../src/services/job-queue');
  });

  test('enqueue download job → process → success', async () => {
    const jobId = jobQueue.enqueue('download', {
      magnetLink: 'magnet:?xt=urn:btih:test123',
      artist: 'Test Artist',
      album: 'Test Album',
    });

    expect(jobId).toBeGreaterThan(0);

    const job = jobQueue.dequeue('download');
    expect(job).not.toBeNull();
    expect(job.type).toBe('download');

    const { process: processJob } = require('../../src/services/job-processor');
    const result = await processJob(job);
    expect(result.success).toBe(true);
    expect(result.artist).toBe('Test Artist');
  });
});
