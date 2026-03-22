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

const mockJobQueueEnqueue = jest.fn().mockReturnValue(42);
jest.mock('../../src/services/job-queue', () => ({
  enqueue: (...a) => mockJobQueueEnqueue(...a),
}));

jest.mock('../../src/api/pipeline', () => ({
  isDownloadActive: jest.fn().mockReturnValue(false),
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
    fs.existsSync.mockReturnValue(false);
    fs.readdirSync.mockReturnValue([]);
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
      if (opts?.withFileTypes) {
        return [
          { name: '01 One More Time.flac', isDirectory: () => false },
          { name: '02 Aerodynamic.flac', isDirectory: () => false },
        ];
      }
      return ['01 One More Time.flac', '02 Aerodynamic.flac'];
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
