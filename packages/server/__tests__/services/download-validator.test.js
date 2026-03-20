'use strict';

// download-validator uses ffprobe and MusicBrainz — mock both
const childProcess = require('child_process');
jest.mock('child_process');

const mockGetReleaseTracks = jest.fn();
const mockSearchReleases = jest.fn();
jest.mock('../../src/services/musicbrainz', () => ({
  getReleaseTracks: (...args) => mockGetReleaseTracks(...args),
  searchReleases: (...args) => mockSearchReleases(...args),
}));

const { validate, computeScore } = require('../../src/services/download-validator');

// Helper: mock ffprobe to return specific durations for files
function mockFfprobe(durations) {
  let callIdx = 0;
  childProcess.execSync.mockImplementation((cmd) => {
    if (cmd.includes('ffprobe')) {
      const dur = durations[callIdx++] || 0;
      return JSON.stringify({ format: { duration: String(dur) } });
    }
    return '';
  });
}

describe('download-validator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('computeScore', () => {
    test('perfect match returns score near 0', () => {
      const expected = [
        { position: 1, title: 'Track 1', lengthMs: 240000 },
        { position: 2, title: 'Track 2', lengthMs: 300000 },
        { position: 3, title: 'Track 3', lengthMs: 180000 },
      ];
      const actual = [240, 300, 180];
      const result = computeScore(expected, actual);
      expect(result.score).toBeLessThan(0.05);
      expect(result.confidence).toBe('high');
      expect(result.trackCount.expected).toBe(3);
      expect(result.trackCount.actual).toBe(3);
    });

    test('duration deltas within 10s grace score 0', () => {
      const expected = [
        { position: 1, title: 'T1', lengthMs: 240000 },
        { position: 2, title: 'T2', lengthMs: 300000 },
      ];
      const actual = [245, 295];
      const result = computeScore(expected, actual);
      expect(result.score).toBeLessThan(0.05);
      expect(result.confidence).toBe('high');
    });

    test('duration deltas 20s average scores medium', () => {
      const expected = [
        { position: 1, title: 'T1', lengthMs: 240000 },
        { position: 2, title: 'T2', lengthMs: 300000 },
      ];
      const actual = [260, 320];
      const result = computeScore(expected, actual);
      expect(result.score).toBeGreaterThan(0.15);
      expect(result.score).toBeLessThan(0.40);
      expect(result.confidence).toBe('medium');
    });

    test('wrong album (very different durations) scores low confidence', () => {
      const expected = [
        { position: 1, title: 'T1', lengthMs: 240000 },
        { position: 2, title: 'T2', lengthMs: 300000 },
        { position: 3, title: 'T3', lengthMs: 180000 },
      ];
      const actual = [60, 90, 45];
      const result = computeScore(expected, actual);
      expect(result.score).toBeGreaterThanOrEqual(0.40);
      expect(result.confidence).toBe('low');
    });

    test('track count off by 1 adds moderate penalty', () => {
      const expected = [
        { position: 1, title: 'T1', lengthMs: 240000 },
        { position: 2, title: 'T2', lengthMs: 300000 },
      ];
      const actual = [240, 300, 200];
      const result = computeScore(expected, actual);
      expect(result.score).toBeLessThan(0.25);
    });

    test('track count off by 2+ adds full penalty', () => {
      const expected = [
        { position: 1, title: 'T1', lengthMs: 240000 },
      ];
      const actual = [240, 300, 200, 180, 250];
      const result = computeScore(expected, actual);
      expect(result.score).toBeGreaterThan(0.25);
    });

    test('greedy pairing handles out-of-order tracks', () => {
      const expected = [
        { position: 1, title: 'T1', lengthMs: 120000 },
        { position: 2, title: 'T2', lengthMs: 300000 },
        { position: 3, title: 'T3', lengthMs: 240000 },
      ];
      const actual = [300, 240, 120];
      const result = computeScore(expected, actual);
      expect(result.score).toBeLessThan(0.05);
      expect(result.confidence).toBe('high');
    });
  });

  describe('validate', () => {
    test('returns high confidence when MB tracks match', async () => {
      mockGetReleaseTracks.mockResolvedValue([
        { position: 1, title: 'Track 1', lengthMs: 240000 },
        { position: 2, title: 'Track 2', lengthMs: 300000 },
      ]);
      mockFfprobe([240, 300]);

      const result = await validate({
        files: ['/staging/01.flac', '/staging/02.flac'],
        mbid: 'test-mbid',
      });

      expect(result.confidence).toBe('high');
      expect(mockGetReleaseTracks).toHaveBeenCalledWith('test-mbid');
    });

    test('falls back to searchReleases when no mbid', async () => {
      mockSearchReleases.mockResolvedValue([{ mbid: 'found-mbid', artist: 'A', album: 'B' }]);
      mockGetReleaseTracks.mockResolvedValue([
        { position: 1, title: 'T1', lengthMs: 200000 },
      ]);
      mockFfprobe([200]);

      const result = await validate({
        files: ['/staging/01.flac'],
        artist: 'A',
        album: 'B',
      });

      expect(result.confidence).toBe('high');
      expect(mockSearchReleases).toHaveBeenCalled();
    });

    test('uses rgid fallback when mbid absent but rgid provided', async () => {
      mockSearchReleases.mockResolvedValue([{ mbid: 'found-from-rgid', artist: 'A', album: 'B' }]);
      mockGetReleaseTracks.mockResolvedValue([
        { position: 1, title: 'T1', lengthMs: 210000 },
        { position: 2, title: 'T2', lengthMs: 270000 },
      ]);
      mockFfprobe([210, 270]);

      const result = await validate({
        files: ['/staging/01.flac', '/staging/02.flac'],
        rgid: 'test-rgid',
      });

      expect(result.confidence).toBe('high');
      expect(mockSearchReleases).toHaveBeenCalledWith('rgid:test-rgid');
      expect(mockGetReleaseTracks).toHaveBeenCalledWith('found-from-rgid');
    });

    test('returns fallback result when MB unavailable', async () => {
      mockGetReleaseTracks.mockRejectedValue(new Error('MB down'));
      mockSearchReleases.mockRejectedValue(new Error('MB down'));
      mockFfprobe([240, 300, 180, 200, 250, 220, 280, 190]);

      const result = await validate({
        files: Array(8).fill('/staging/track.flac'),
        mbid: 'bad-mbid',
        existingTrackCount: 9,
      });

      expect(result.confidence).not.toBe('low');
      expect(result.details).toContain('fallback');
    });

    test('fallback rejects when track count too different', async () => {
      mockGetReleaseTracks.mockRejectedValue(new Error('MB down'));
      mockSearchReleases.mockRejectedValue(new Error('MB down'));
      mockFfprobe([240, 300]);

      const result = await validate({
        files: ['/staging/01.flac', '/staging/02.flac'],
        mbid: 'bad-mbid',
        existingTrackCount: 12,
      });

      expect(result.confidence).toBe('low');
    });

    test('fallback for new album checks duration range', async () => {
      mockGetReleaseTracks.mockRejectedValue(new Error('MB down'));
      mockSearchReleases.mockRejectedValue(new Error('MB down'));
      mockFfprobe([240, 240, 240, 240, 240]);

      const result = await validate({
        files: Array(5).fill('/staging/track.flac'),
        artist: 'A',
        album: 'B',
      });

      expect(result.confidence).not.toBe('low');
    });
  });
});
