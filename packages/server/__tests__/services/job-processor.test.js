'use strict';

// Mock all external dependencies
const mockAddMagnet = jest.fn();
const mockSelectFiles = jest.fn();
const mockGetTorrentInfo = jest.fn();
const mockUnrestrictLink = jest.fn();
const mockDeleteTorrent = jest.fn();
jest.mock('../../src/services/realdebrid', () => ({
  addMagnet: (...a) => mockAddMagnet(...a),
  selectFiles: (...a) => mockSelectFiles(...a),
  getTorrentInfo: (...a) => mockGetTorrentInfo(...a),
  unrestrictLink: (...a) => mockUnrestrictLink(...a),
  deleteTorrent: (...a) => mockDeleteTorrent(...a),
}));

const mockDownloadFile = jest.fn();
const mockExtractArchive = jest.fn();
const mockSelectAlbumFiles = jest.fn();
jest.mock('../../src/services/downloader', () => ({
  downloadFile: (...a) => mockDownloadFile(...a),
  extractArchive: (...a) => mockExtractArchive(...a),
  selectAlbumFiles: (...a) => mockSelectAlbumFiles(...a),
  isAudioFile: (f) => /\.(flac|mp3|ogg|m4a|aac|wav|opus)$/i.test(f),
  isArchive: (f) => /\.(rar|zip)$/i.test(f),
  sanitizePath: (s) => s.replace(/[<>:"/\\|?*]/g, '_').trim(),
}));

const mockValidateFile = jest.fn();
jest.mock('../../src/services/file-validator', () => ({
  validateFile: (...a) => mockValidateFile(...a),
}));

const mockDownloadValidate = jest.fn();
jest.mock('../../src/services/download-validator', () => ({
  validate: (...a) => mockDownloadValidate(...a),
}));

const mockLog = jest.fn();
jest.mock('../../src/services/activity-log', () => ({
  log: (...a) => mockLog(...a),
}));

const mockEnqueueDownload = jest.fn();
const mockPollDownloads = jest.fn();
jest.mock('../../src/services/soulseek', () => ({
  enqueueDownload: (...a) => mockEnqueueDownload(...a),
  pollDownloads: (...a) => mockPollDownloads(...a),
}));

const mockSearchForUpgrade = jest.fn();
jest.mock('../../src/services/search', () => ({
  searchForUpgrade: (...a) => mockSearchForUpgrade(...a),
}));

const mockProbeFile = jest.fn();
const mockGetExistingQuality = jest.fn();
jest.mock('../../src/services/library-check', () => ({
  probeFile: (...a) => mockProbeFile(...a),
  isUpgrade: jest.requireActual('../../src/services/library-check').isUpgrade,
  QUALITY_RANK: jest.requireActual('../../src/services/library-check').QUALITY_RANK,
  getExistingQuality: (...a) => mockGetExistingQuality(...a),
}));

const mockJobQueueEnqueue = jest.fn().mockReturnValue(42);
jest.mock('../../src/services/job-queue', () => ({
  enqueue: (...a) => mockJobQueueEnqueue(...a),
}));

jest.mock('../../src/api/pipeline', () => ({
  isDownloadActive: jest.fn().mockReturnValue(false),
}));

jest.mock('../../src/services/db', () => ({
  getGlobalSetting: () => null,
}));

const fs = require('fs');
jest.mock('fs');

const { process: processJob } = require('../../src/services/job-processor');

describe('job-processor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MUSIC_DIR = '/test/music';
    fs.mkdirSync.mockReturnValue(undefined);
    fs.renameSync.mockReturnValue(undefined);
    fs.rmSync.mockReturnValue(undefined);
    fs.unlinkSync.mockReturnValue(undefined);
    fs.existsSync.mockReturnValue(false);
    fs.readdirSync.mockReturnValue([]);
    // Default: incoming files are flac quality
    mockProbeFile.mockReturnValue({ quality: 'flac', duration: 240 });
  });

  test('processes download job end-to-end', async () => {
    const job = {
      id: 1,
      type: 'download',
      payload: JSON.stringify({ magnetLink: 'magnet:?xt=urn:btih:abc', artist: 'Artist', album: 'Album' }),
    };

    mockAddMagnet.mockResolvedValue({ id: 'rd-123' });
    mockGetTorrentInfo
      .mockResolvedValueOnce({ status: 'waiting_files_selection', files: [{ id: 1, path: '01.flac', bytes: 30000000 }] })
      .mockResolvedValueOnce({ status: 'downloaded', links: ['https://rd.io/file1'] });
    mockSelectAlbumFiles.mockReturnValue({ fileIds: [1], isDiscography: false });
    mockSelectFiles.mockResolvedValue(undefined);
    mockUnrestrictLink.mockResolvedValue({ download: 'https://dl.rd.io/file1', filename: '01.flac' });
    mockDownloadFile.mockResolvedValue('/test/music/_staging/Artist/Album/01.flac');
    mockValidateFile.mockResolvedValue({ passed: true, checks: [] });
    mockDownloadValidate.mockResolvedValue({ score: 0.05, confidence: 'high', details: 'ok' });

    const result = await processJob(job);
    expect(result.success).toBe(true);
    expect(mockAddMagnet).toHaveBeenCalledWith('magnet:?xt=urn:btih:abc');
    expect(mockSelectFiles).toHaveBeenCalledWith('rd-123', '1');
    expect(mockDeleteTorrent).toHaveBeenCalledWith('rd-123');
  });

  test('fails job when download validation rejects', async () => {
    const job = {
      id: 2,
      type: 'download',
      payload: JSON.stringify({ magnetLink: 'magnet:?xt=urn:btih:xyz', artist: 'A', album: 'B' }),
    };

    mockAddMagnet.mockResolvedValue({ id: 'rd-456' });
    mockGetTorrentInfo
      .mockResolvedValueOnce({ status: 'waiting_files_selection', files: [{ id: 1, path: '01.flac', bytes: 30000000 }] })
      .mockResolvedValueOnce({ status: 'downloaded', links: ['https://rd.io/f1'] });
    mockSelectAlbumFiles.mockReturnValue({ fileIds: [1], isDiscography: false });
    mockSelectFiles.mockResolvedValue(undefined);
    mockUnrestrictLink.mockResolvedValue({ download: 'https://dl.rd.io/f1', filename: '01.flac' });
    mockDownloadFile.mockResolvedValue('/test/music/_staging/A/B/01.flac');
    mockValidateFile.mockResolvedValue({ passed: true, checks: [] });
    mockDownloadValidate.mockResolvedValue({ score: 0.60, confidence: 'low', details: 'wrong album' });

    await expect(processJob(job)).rejects.toThrow(/validation failed/i);
    // Staging should be cleaned up
    expect(fs.rmSync).toHaveBeenCalled();
  });

  test('skips unknown job types', async () => {
    const job = { id: 3, type: 'unknown', payload: '{}' };
    const result = await processJob(job);
    expect(result.skipped).toBe(true);
  });

  test('processes soulseek-download job end-to-end', async () => {
    // Use tiny poll interval for test speed
    process.env.SLSK_POLL_INTERVAL = '0';
    process.env.SLSKD_DOWNLOADS_DIR = '/slskd-downloads';

    const job = {
      id: 10,
      type: 'soulseek-download',
      payload: JSON.stringify({
        artist: 'Daft Punk',
        album: 'Discovery',
        soulseekUser: 'musicfan99',
        files: [
          { filename: '\\\\music\\\\Daft Punk\\\\Discovery\\\\01 One More Time.flac', size: 35000000 },
          { filename: '\\\\music\\\\Daft Punk\\\\Discovery\\\\02 Aerodynamic.flac', size: 30000000 },
        ],
      }),
    };

    mockEnqueueDownload.mockResolvedValue(true);
    mockPollDownloads.mockResolvedValueOnce([{
      username: 'musicfan99',
      directories: [{
        directory: 'Discovery',
        files: [
          { filename: '01 One More Time.flac', state: 'Completed, Succeeded', size: 35000000 },
          { filename: '02 Aerodynamic.flac', state: 'Completed, Succeeded', size: 30000000 },
        ],
      }],
    }]);

    // Mock fs to simulate files in shared volume
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockImplementation((dir, opts) => {
      // Downloads directory — has files with withFileTypes
      if (dir && dir.includes('slskd-downloads') && opts?.withFileTypes) {
        return [
          { name: '01 One More Time.flac', isDirectory: () => false },
          { name: '02 Aerodynamic.flac', isDirectory: () => false },
        ];
      }
      // Dest directory for replaceTracksIfBetter — no existing tracks (fresh album)
      if (dir && dir.includes('Daft Punk') && !dir.includes('slskd')) {
        return [];
      }
      if (opts?.withFileTypes) return [];
      return [];
    });
    fs.copyFileSync = jest.fn();

    mockValidateFile.mockResolvedValue({ passed: true, checks: [] });
    mockDownloadValidate.mockResolvedValue({ score: 0.05, confidence: 'high', details: 'ok' });

    const result = await processJob(job);
    expect(result.success).toBe(true);
    expect(result.source).toBe('soulseek');
    expect(result.files).toBe(2);
    expect(mockEnqueueDownload).toHaveBeenCalledWith('musicfan99', expect.any(Array));
  });

  test('upgrade enqueues soulseek-download when source is soulseek', async () => {
    const job = { id: 20, type: 'upgrade', payload: JSON.stringify({ artist: 'Artist', album: 'Album' }) };

    mockSearchForUpgrade.mockResolvedValue({
      source: 'soulseek',
      name: 'Artist - Album [Soulseek: user1]',
      score: 0.85,
      soulseekUser: 'user1',
      files: [{ filename: 'track.flac', size: 30000000 }],
    });

    const result = await processJob(job);
    expect(result.success).toBe(true);
    expect(result.source).toBe('Artist - Album [Soulseek: user1]');
    expect(mockJobQueueEnqueue).toHaveBeenCalledWith(
      'soulseek-download',
      expect.objectContaining({ soulseekUser: 'user1' }),
      expect.any(Object)
    );
  });
});

describe('replaceTracksIfBetter (per-track upgrade)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MUSIC_DIR = '/test/music';
    fs.mkdirSync.mockReturnValue(undefined);
    fs.renameSync.mockReturnValue(undefined);
    fs.rmSync.mockReturnValue(undefined);
    fs.unlinkSync.mockReturnValue(undefined);
    fs.existsSync.mockReturnValue(false);
    fs.readdirSync.mockReturnValue([]);
  });

  // Helper: set up a download job that reaches the replacement step
  async function runDownloadToReplacement({ existingFiles, existingQualities, incomingFiles, incomingQualities, metadata }) {
    const job = {
      id: 100,
      type: 'download',
      payload: JSON.stringify({ magnetLink: 'magnet:?xt=urn:btih:test', artist: 'Test', album: 'Album' }),
    };

    mockAddMagnet.mockResolvedValue({ id: 'rd-test' });
    mockGetTorrentInfo
      .mockResolvedValueOnce({
        status: 'waiting_files_selection',
        files: incomingFiles.map((f, i) => ({ id: i + 1, path: f, bytes: 30000000 })),
      })
      .mockResolvedValueOnce({
        status: 'downloaded',
        links: incomingFiles.map((_, i) => `https://rd.io/f${i}`),
      });
    mockSelectAlbumFiles.mockReturnValue({ fileIds: incomingFiles.map((_, i) => i + 1), isDiscography: false });
    mockSelectFiles.mockResolvedValue(undefined);

    // Mock unrestrict + download for each incoming file
    incomingFiles.forEach((f, i) => {
      mockUnrestrictLink.mockResolvedValueOnce({ download: `https://dl.rd.io/f${i}`, filename: f });
      mockDownloadFile.mockResolvedValueOnce(`/test/music/_staging/Test/Album/${f}`);
    });

    mockValidateFile.mockResolvedValue({ passed: true, checks: [] });
    mockDownloadValidate.mockResolvedValue({ score: 0.05, confidence: 'high', details: 'ok' });

    // Mock fs for replaceTracksIfBetter
    fs.existsSync.mockImplementation((p) => {
      if (p.includes('.metadata.json') && metadata) return true;
      if (p.includes('_staging')) return true;
      return existingFiles.length > 0;
    });
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('.metadata.json') && metadata) return JSON.stringify(metadata);
      return '';
    });
    fs.readdirSync.mockImplementation((dir) => {
      // Destination dir — return existing files
      if (dir.includes('Test') && dir.includes('Album') && !dir.includes('_staging')) {
        return existingFiles;
      }
      return [];
    });

    // Mock probeFile to return different qualities for existing vs incoming
    mockProbeFile.mockImplementation((filePath) => {
      const basename = require('path').basename(filePath);
      // Check if it's an existing file
      const existIdx = existingFiles.indexOf(basename);
      if (existIdx >= 0) {
        return { quality: existingQualities[existIdx], duration: 240 + existIdx };
      }
      // It's an incoming file (in staging)
      const inIdx = incomingFiles.indexOf(basename);
      if (inIdx >= 0) {
        return { quality: incomingQualities[inIdx], duration: 240 + inIdx };
      }
      return { quality: 'unknown', duration: 0 };
    });

    return processJob(job);
  }

  test('all upgrades — replaces all tracks when incoming is better', async () => {
    const result = await runDownloadToReplacement({
      existingFiles: ['01-Song A.mp3', '02-Song B.mp3', '03-Song C.mp3'],
      existingQualities: ['128', '128', '128'],
      incomingFiles: ['01 Song A.flac', '02 Song B.flac', '03 Song C.flac'],
      incomingQualities: ['flac', 'flac', 'flac'],
    });

    expect(result.success).toBe(true);
    expect(result.files).toBe(3);
    expect(result.filesSkipped).toBe(0);
    // Old files should be deleted
    expect(fs.unlinkSync).toHaveBeenCalledTimes(3);
  });

  test('no upgrades — skips all when existing is better', async () => {
    const result = await runDownloadToReplacement({
      existingFiles: ['01-Song A.flac', '02-Song B.flac', '03-Song C.flac'],
      existingQualities: ['flac', 'flac', 'flac'],
      incomingFiles: ['01 Song A.mp3', '02 Song B.mp3', '03 Song C.mp3'],
      incomingQualities: ['128', '128', '128'],
    });

    expect(result.success).toBe(true);
    expect(result.files).toBe(0);
    expect(result.filesSkipped).toBe(3);
    // No old files should be deleted
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  test('mixed quality — replaces only better tracks', async () => {
    const result = await runDownloadToReplacement({
      existingFiles: ['01-Song A.mp3', '02-Song B.flac', '03-Song C.mp3'],
      existingQualities: ['128', 'flac', '256'],
      incomingFiles: ['01 Song A.flac', '02 Song B.mp3', '03 Song C.flac'],
      incomingQualities: ['flac', '320', 'flac'],
    });

    expect(result.success).toBe(true);
    expect(result.files).toBe(2);      // tracks 01 and 03 upgraded
    expect(result.filesSkipped).toBe(1); // track 02 skipped (320 < flac)
  });

  test('partial album — upgrades matching tracks, leaves others alone', async () => {
    const result = await runDownloadToReplacement({
      existingFiles: ['01-Song A.mp3', '02-Song B.mp3', '03-Song C.mp3'],
      existingQualities: ['128', '128', '128'],
      incomingFiles: ['01 Song A.flac', '02 Song B.flac'],
      incomingQualities: ['flac', 'flac'],
    });

    expect(result.success).toBe(true);
    expect(result.files).toBe(2);
    // Track 03 should not be touched
    expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
  });

  test('excluded tracks — skips tracks in metadata excluded list', async () => {
    const result = await runDownloadToReplacement({
      existingFiles: ['01-Song A.mp3', '02-Song B.mp3'],
      existingQualities: ['128', '128'],
      incomingFiles: ['01 Song A.flac', '02 Song B.flac'],
      incomingQualities: ['flac', 'flac'],
      metadata: { excluded: ['01-Song A.mp3'] },
    });

    expect(result.success).toBe(true);
    expect(result.files).toBe(1);      // only track 02
    expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
  });

  test('fresh album — moves all files with no quality checks', async () => {
    const result = await runDownloadToReplacement({
      existingFiles: [],
      existingQualities: [],
      incomingFiles: ['01 Song A.flac', '02 Song B.flac'],
      incomingQualities: ['flac', 'flac'],
    });

    expect(result.success).toBe(true);
    expect(result.files).toBe(2);
    // No deletions (no existing files)
    expect(fs.unlinkSync).not.toHaveBeenCalled();
    // probeFile should not be called for quality comparison (fast path)
    // (it may still be called for other purposes, but not for existing tracks)
  });

  test('title-based match — matches by normalized title when no track number in existing', async () => {
    const result = await runDownloadToReplacement({
      existingFiles: ['Better Give U Up.mp3', 'Skyline.mp3'],
      existingQualities: ['256', '256'],
      incomingFiles: ['03-Better Give U Up.flac', '04-Skyline.flac'],
      incomingQualities: ['flac', 'flac'],
    });

    expect(result.success).toBe(true);
    expect(result.files).toBe(2);
    expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
  });

  test('same quality — skips when incoming is not strictly better', async () => {
    const result = await runDownloadToReplacement({
      existingFiles: ['01-Song A.mp3'],
      existingQualities: ['320'],
      incomingFiles: ['01 Song A.mp3'],
      incomingQualities: ['320'],
    });

    expect(result.success).toBe(true);
    expect(result.files).toBe(0);
    expect(result.filesSkipped).toBe(1);
  });

  test('unmatched incoming track — accepted as new', async () => {
    const result = await runDownloadToReplacement({
      existingFiles: ['01-Song A.mp3'],
      existingQualities: ['128'],
      incomingFiles: ['01 Song A.flac', '99 Bonus Track.flac'],
      incomingQualities: ['flac', 'flac'],
    });

    expect(result.success).toBe(true);
    expect(result.files).toBe(2); // both: track 01 upgraded + track 99 added as new
  });
});
