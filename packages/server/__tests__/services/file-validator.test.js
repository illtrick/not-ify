'use strict';

const childProcess = require('child_process');
const fs = require('fs');

// Require once — env vars are read at call-time so we can change them per-test
const fileValidator = require('../../src/services/file-validator');

const FAKE_PATH = '/tmp/test-track.mp3';
const VALID_FFPROBE_OUTPUT = JSON.stringify({
  format: { format_name: 'mp3', bit_rate: '192000', duration: '180' },
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.MIME_CHECK_ENABLED;
});

// Sets up execFileSync mock: mime + ffprobe return values/errors
function mockExecSync({ mime = 'audio/mpeg\n', ffprobe } = {}) {
  const ffprobeOut = ffprobe !== undefined ? ffprobe : VALID_FFPROBE_OUTPUT;
  jest.spyOn(childProcess, 'execFileSync').mockImplementation((cmd) => {
    if (cmd === 'file') {
      if (mime instanceof Error) throw mime;
      return Buffer.from(mime);
    }
    if (cmd === 'ffprobe') {
      if (ffprobeOut instanceof Error) throw ffprobeOut;
      return Buffer.from(ffprobeOut);
    }
    return Buffer.from('');
  });
}

function mockStatSync(size) {
  jest.spyOn(fs, 'statSync').mockReturnValue({ size });
}

describe('file-validator', () => {
  describe('rejects non-audio MIME type', () => {
    it('fails validation when MIME type is not audio', async () => {
      process.env.MIME_CHECK_ENABLED = 'true';
      mockStatSync(1024 * 1024);
      mockExecSync({ mime: 'application/zip\n' });

      const result = await fileValidator.validateFile(FAKE_PATH);

      expect(result.passed).toBe(false);
      const mimeCheck = result.checks.find(c => c.name === 'mime');
      expect(mimeCheck).toBeDefined();
      expect(mimeCheck.passed).toBe(false);
    });
  });

  describe('rejects file that ffprobe cannot parse', () => {
    it('fails validation when ffprobe throws', async () => {
      process.env.MIME_CHECK_ENABLED = 'false';
      mockStatSync(1024 * 1024);
      mockExecSync({ ffprobe: new Error('ffprobe: invalid data found when processing input') });

      const result = await fileValidator.validateFile(FAKE_PATH);

      expect(result.passed).toBe(false);
      const ffprobeCheck = result.checks.find(c => c.name === 'ffprobe');
      expect(ffprobeCheck).toBeDefined();
      expect(ffprobeCheck.passed).toBe(false);
    });
  });

  describe('accepts valid FLAC file', () => {
    it('passes all checks for a valid FLAC', async () => {
      process.env.MIME_CHECK_ENABLED = 'false';
      const flacFfprobe = JSON.stringify({
        format: { format_name: 'flac', bit_rate: '900000', duration: '240' },
      });
      mockStatSync(20 * 1024 * 1024);
      mockExecSync({ ffprobe: flacFfprobe });

      const result = await fileValidator.validateFile('/tmp/test.flac');

      expect(result.passed).toBe(true);
      expect(result.checks.every(c => c.passed === true || c.skipped === true)).toBe(true);
    });
  });

  describe('accepts valid MP3 file', () => {
    it('passes all checks for a valid MP3', async () => {
      process.env.MIME_CHECK_ENABLED = 'false';
      mockStatSync(5 * 1024 * 1024);
      mockExecSync({ ffprobe: VALID_FFPROBE_OUTPUT });

      const result = await fileValidator.validateFile(FAKE_PATH);

      expect(result.passed).toBe(true);
      const ffprobeCheck = result.checks.find(c => c.name === 'ffprobe');
      expect(ffprobeCheck.passed).toBe(true);
    });
  });

  describe('rejects files over MAX_AUDIO_FILE_SIZE (500MB)', () => {
    it('fails when file exceeds 500 MB', async () => {
      process.env.MIME_CHECK_ENABLED = 'false';
      mockStatSync(501 * 1024 * 1024);
      // execFileSync should not be called at all (early return after size check)
      const execSpy = jest.spyOn(childProcess, 'execFileSync');

      const result = await fileValidator.validateFile(FAKE_PATH);

      expect(result.passed).toBe(false);
      const sizeCheck = result.checks.find(c => c.name === 'size');
      expect(sizeCheck).toBeDefined();
      expect(sizeCheck.passed).toBe(false);
      expect(execSpy).not.toHaveBeenCalled();
    });

    it('passes when file is exactly at the 500 MB limit', async () => {
      process.env.MIME_CHECK_ENABLED = 'false';
      mockStatSync(500 * 1024 * 1024);
      mockExecSync({ ffprobe: VALID_FFPROBE_OUTPUT });

      const result = await fileValidator.validateFile(FAKE_PATH);

      const sizeCheck = result.checks.find(c => c.name === 'size');
      expect(sizeCheck.passed).toBe(true);
    });
  });

  describe('result structure', () => {
    it('returns path, passed, and checks array', async () => {
      process.env.MIME_CHECK_ENABLED = 'false';
      mockStatSync(1024 * 1024);
      mockExecSync({ ffprobe: VALID_FFPROBE_OUTPUT });

      const result = await fileValidator.validateFile(FAKE_PATH);

      expect(result).toHaveProperty('path', FAKE_PATH);
      expect(result).toHaveProperty('passed');
      expect(Array.isArray(result.checks)).toBe(true);
      expect(result.checks.length).toBeGreaterThan(0);
    });

    it('each check has a name and detail', async () => {
      process.env.MIME_CHECK_ENABLED = 'false';
      mockStatSync(1024 * 1024);
      mockExecSync({ ffprobe: VALID_FFPROBE_OUTPUT });

      const result = await fileValidator.validateFile(FAKE_PATH);

      for (const check of result.checks) {
        expect(check).toHaveProperty('name');
        expect(check).toHaveProperty('detail');
      }
    });
  });
});
