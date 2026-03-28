'use strict';

const Database = require('better-sqlite3');

// mockDb is the shared proxy — jest.mock factory may reference 'mock*' variables
let mockDb = null;

// These need to be declared before the mock factory captures them (hoisted),
// so we use module-level vars and proxy calls through them.
let mockAddJobLog = () => {};
let mockGetJobLogs = () => [];

let jobQueue, worker;
// Keep a real db reference for job_log queries (we'll use the mockDb directly)
let realDb;

beforeEach(() => {
  // Fresh in-memory database for each test
  mockDb = new Database(':memory:');
  mockDb.pragma('journal_mode = WAL');
  realDb = mockDb;

  // Set up job_log table in the in-memory db
  mockDb.exec(`
    CREATE TABLE IF NOT EXISTS job_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER,
      artist TEXT,
      album TEXT,
      attempt INTEGER,
      duration_ms INTEGER,
      outcome TEXT,
      fail_reason TEXT,
      quality TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);

  // Wire real implementations of addJobLog/getJobLogs against the in-memory db
  mockAddJobLog = (entry) => {
    mockDb.prepare(`INSERT INTO job_log (job_id, artist, album, attempt, duration_ms, outcome, fail_reason, quality)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      entry.job_id, entry.artist, entry.album, entry.attempt,
      entry.duration_ms, entry.outcome, entry.fail_reason || null, entry.quality || null
    );
  };
  mockGetJobLogs = (limit = 100) => {
    return mockDb.prepare(`SELECT * FROM job_log ORDER BY created_at DESC LIMIT ?`).all(limit);
  };

  jest.resetModules();
  jest.mock('../../src/services/db', () => ({
    getDb: () => mockDb,
    addJobLog: (...args) => mockAddJobLog(...args),
    getJobLogs: (...args) => mockGetJobLogs(...args),
    getGlobalSetting: () => null,
    close: () => { if (mockDb && mockDb.open) { mockDb.close(); mockDb = null; } },
  }));

  jobQueue = require('../../src/services/job-queue');
  worker = require('../../src/services/job-worker');
});

afterEach(() => {
  worker.stop();
  if (mockDb && mockDb.open) {
    mockDb.close();
    mockDb = null;
  }
});

describe('job-worker', () => {
  test('processNextJob picks highest priority first', async () => {
    jobQueue.enqueue('download', { artist: 'BG', album: 'BG' }, { priority: 0 }); // background
    jobQueue.enqueue('download', { artist: 'Manual', album: 'Manual' }, { priority: 1 }); // manual
    worker.setProcessor(async (job) => ({ quality: 'flac' }));
    await worker.processNextJob();
    // Manual (priority 1) should have been dequeued first
    const remaining = jobQueue.getByStatus('pending');
    expect(remaining.length).toBe(1);
    expect(JSON.parse(remaining[0].payload).artist).toBe('BG');
  });

  test('processNextJob returns false when queue empty', async () => {
    worker.setProcessor(async () => ({}));
    const result = await worker.processNextJob();
    expect(result).toBe(false);
  });

  test('failed job increments retries', async () => {
    jobQueue.enqueue('download', { artist: 'Fail', album: 'Test' }, { priority: 0 });
    worker.setProcessor(async () => { throw new Error('download failed'); });
    await worker.processNextJob();
    const job = jobQueue.getByStatus('pending')[0];
    expect(job).toBeDefined();
    expect(job.retries).toBe(1);
  });

  test('job_log entry created on completion', async () => {
    jobQueue.enqueue('download', { artist: 'Log', album: 'Test' }, { priority: 0 });
    worker.setProcessor(async () => ({ quality: 'flac' }));
    await worker.processNextJob();
    const logs = mockGetJobLogs(10);
    expect(logs.length).toBeGreaterThan(0);
    const successLog = logs.find(l => l.outcome === 'success');
    expect(successLog).toBeDefined();
    expect(successLog.quality).toBe('flac');
  });

  test('job_log entry created on failure with reason', async () => {
    jobQueue.enqueue('download', { artist: 'Err', album: 'Test' }, { priority: 0 });
    worker.setProcessor(async () => { throw new Error('RD API timeout'); });
    await worker.processNextJob();
    const logs = mockGetJobLogs(10);
    const failLog = logs.find(l => l.outcome === 'failed');
    expect(failLog).toBeDefined();
    expect(failLog.fail_reason).toContain('RD API timeout');
  });
});
