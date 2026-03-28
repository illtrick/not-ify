const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.CONFIG_DIR = path.join(os.tmpdir(), `notify-test-${process.pid}`);

// Ensure the CONFIG_DIR exists so db.js can initialize
fs.mkdirSync(process.env.CONFIG_DIR, { recursive: true });

describe('download stall detection', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('downloadFile cancels stream after inactivity', async () => {
    jest.resetModules();
    const downloader = require('../../src/services/downloader');
    const destPath = path.join(os.tmpdir(), `test-download-${Date.now()}.tmp`);

    // Mock fetch to return a stream that stalls after first chunk
    let readCount = 0;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => '0' },
      body: {
        getReader: () => ({
          read: jest.fn().mockImplementation(async () => {
            readCount++;
            if (readCount === 1) {
              return { done: false, value: Buffer.from('hello') };
            }
            // Stall forever on second read
            await new Promise(resolve => setTimeout(resolve, 200000));
            return { done: false, value: Buffer.from('world') };
          }),
          cancel: jest.fn(),
        }),
      },
    });

    await expect(
      downloader.downloadFile('http://fake/url', destPath, { inactivityTimeout: 50 })
    ).rejects.toThrow();

    // cleanup
    try { fs.unlinkSync(destPath); } catch {}
  }, 10000);
});

describe('RealDebrid API timeout', () => {
  let originalFetch;
  let originalAbortSignalTimeout;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalAbortSignalTimeout = AbortSignal.timeout;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    AbortSignal.timeout = originalAbortSignalTimeout;
    jest.resetModules();
  });

  test('rdFetch rejects on timeout', async () => {
    jest.resetModules();
    process.env.RD_API_KEY = 'test-key';

    // Pre-seed the DB with a token so getToken() doesn't throw
    const db = require('../../src/services/db');
    db.setGlobalSetting('realDebridToken', 'fake-token-for-test');

    const rd = require('../../src/services/realdebrid');

    // Override AbortSignal.timeout to fire after 50ms instead of 30s
    AbortSignal.timeout = (ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('TimeoutError', 'TimeoutError')), 50);
      return controller.signal;
    };

    // Mock fetch to stall indefinitely — the abort signal should cancel it
    global.fetch = jest.fn().mockImplementation((url, opts) => {
      return new Promise((resolve, reject) => {
        if (opts && opts.signal) {
          opts.signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'AbortError')));
        }
        // Never resolves on its own
      });
    });

    await expect(
      rd.getUserInfo()
    ).rejects.toThrow();
  }, 10000);
});
