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
});
