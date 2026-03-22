'use strict';

process.env.SLSKD_URL = 'http://localhost:5030';

describe('soulseek download functions', () => {
  let soulseek;
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    jest.resetModules();
    soulseek = require('../../src/services/soulseek');
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('enqueueDownload(username, files)', () => {
    test('POSTs files to the slskd transfer endpoint and returns true on success', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true });

      const files = [{ filename: '\\path\\to\\file.flac', size: 12345 }];
      const result = await soulseek.enqueueDownload('someuser', files);

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:5030/api/v0/transfers/downloads/someuser',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(files),
        })
      );
    });

    test('returns false when the API responds with a non-ok status', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });

      const result = await soulseek.enqueueDownload('someuser', []);

      expect(result).toBe(false);
    });

    test('returns false when fetch throws (network error)', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('network failure'));

      const result = await soulseek.enqueueDownload('someuser', []);

      expect(result).toBe(false);
    });

    test('URL-encodes the username', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true });

      await soulseek.enqueueDownload('user name/slash', []);

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:5030/api/v0/transfers/downloads/user%20name%2Fslash',
        expect.anything()
      );
    });
  });

  describe('pollDownloads(username)', () => {
    test('returns transfer state array for a username', async () => {
      const mockState = [{ id: 'abc', state: 'Completed', filename: 'file.flac' }];
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockState,
      });

      const result = await soulseek.pollDownloads('someuser');

      expect(result).toEqual(mockState);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:5030/api/v0/transfers/downloads/someuser',
        expect.anything()
      );
    });

    test('returns empty array when API responds with non-ok status', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });

      const result = await soulseek.pollDownloads('unknownuser');

      expect(result).toEqual([]);
    });

    test('returns empty array when fetch throws', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('timeout'));

      const result = await soulseek.pollDownloads('someuser');

      expect(result).toEqual([]);
    });

    test('URL-encodes the username', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      await soulseek.pollDownloads('user with spaces');

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:5030/api/v0/transfers/downloads/user%20with%20spaces',
        expect.anything()
      );
    });
  });

  describe('getDownloadedFiles()', () => {
    test('returns file listing from slskd downloads directory', async () => {
      const mockFiles = [{ name: 'file.flac', path: '/downloads/file.flac' }];
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockFiles,
      });

      const result = await soulseek.getDownloadedFiles();

      expect(result).toEqual(mockFiles);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:5030/api/v0/files/downloads',
        expect.anything()
      );
    });

    test('returns empty array when API responds with non-ok status', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });

      const result = await soulseek.getDownloadedFiles();

      expect(result).toEqual([]);
    });

    test('returns empty array when fetch throws', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('connection refused'));

      const result = await soulseek.getDownloadedFiles();

      expect(result).toEqual([]);
    });
  });
});
