'use strict';

// Use an in-memory SQLite DB for tests. We proxy the db mock via a module-level
// variable named with the 'mock' prefix so Jest's mock-hoisting allows it.
const Database = require('better-sqlite3');

// mockDb is the shared proxy — jest.mock factory may reference 'mock*' variables
let mockDb = null;

jest.mock('../../src/services/db', () => ({
  getDb: () => mockDb,
}));

let jobQueue;

beforeEach(() => {
  // Fresh in-memory database for each test
  mockDb = new Database(':memory:');
  mockDb.pragma('journal_mode = WAL');

  // Reset module registry so job-queue re-requires db and re-runs initSchema
  jest.resetModules();
  // Re-apply mock after resetModules
  jest.mock('../../src/services/db', () => ({
    getDb: () => mockDb,
  }));
  jobQueue = require('../../src/services/job-queue');
});

afterEach(() => {
  if (mockDb && mockDb.open) {
    mockDb.close();
    mockDb = null;
  }
});

describe('job-queue', () => {

  describe('enqueue', () => {
    it('returns a numeric job ID', () => {
      const id = jobQueue.enqueue('download', { url: 'http://example.com/track.mp3' });
      expect(typeof id).toBe('number');
      expect(id).toBeGreaterThan(0);
    });

    it('creates a job with pending status by default', () => {
      const id = jobQueue.enqueue('download', { url: 'http://example.com/track.mp3' });
      const jobs = jobQueue.getByStatus('pending');
      expect(jobs.length).toBe(1);
      expect(jobs[0].id).toBe(id);
      expect(jobs[0].status).toBe('pending');
    });

    it('stores the job type and payload', () => {
      const payload = { url: 'http://example.com/track.mp3', quality: 'flac' };
      const id = jobQueue.enqueue('download', payload);
      const jobs = jobQueue.getByType('download');
      expect(jobs.length).toBe(1);
      expect(jobs[0].type).toBe('download');
      expect(JSON.parse(jobs[0].payload)).toEqual(payload);
    });

    it('accepts optional priority and maxRetries', () => {
      jobQueue.enqueue('upgrade', { trackId: 42 }, { priority: 5, maxRetries: 5 });
      const jobs = jobQueue.getAll();
      expect(jobs[0].priority).toBe(5);
      expect(jobs[0].max_retries).toBe(5);
    });

    it('returns existing job ID when dedupeKey matches a pending job', () => {
      const id1 = jobQueue.enqueue('download', { url: 'http://x.com/a.mp3' }, { dedupeKey: 'dl:a' });
      const id2 = jobQueue.enqueue('download', { url: 'http://x.com/a.mp3' }, { dedupeKey: 'dl:a' });
      expect(id2).toBe(id1);
      expect(jobQueue.getAll().length).toBe(1);
    });

    it('returns existing job ID when dedupeKey matches an active job', () => {
      const id1 = jobQueue.enqueue('download', { url: 'http://x.com/b.mp3' }, { dedupeKey: 'dl:b' });
      jobQueue.dequeue(); // moves it to active
      const id2 = jobQueue.enqueue('download', { url: 'http://x.com/b.mp3' }, { dedupeKey: 'dl:b' });
      expect(id2).toBe(id1);
      expect(jobQueue.getAll().length).toBe(1);
    });

    it('allows a new job with the same dedupeKey after the original is done', () => {
      const id1 = jobQueue.enqueue('download', { url: 'http://x.com/c.mp3' }, { dedupeKey: 'dl:c' });
      jobQueue.complete(id1, { file: '/music/c.mp3' });
      const id2 = jobQueue.enqueue('download', { url: 'http://x.com/c.mp3' }, { dedupeKey: 'dl:c' });
      expect(id2).not.toBe(id1);
      expect(jobQueue.getAll().length).toBe(2);
    });
  });

  describe('dequeue', () => {
    it('returns null when no jobs are pending', () => {
      const job = jobQueue.dequeue();
      expect(job).toBeNull();
    });

    it('returns the oldest pending job and marks it active', () => {
      jobQueue.enqueue('download', { n: 1 });
      jobQueue.enqueue('download', { n: 2 });
      const job = jobQueue.dequeue();
      expect(job).not.toBeNull();
      expect(JSON.parse(job.payload)).toEqual({ n: 1 });
      expect(job.status).toBe('active');
    });

    it('does not return the same job twice (atomic dequeue)', () => {
      jobQueue.enqueue('download', { n: 1 });
      const job1 = jobQueue.dequeue();
      const job2 = jobQueue.dequeue();
      expect(job1).not.toBeNull();
      expect(job2).toBeNull();
    });

    it('returns highest priority job first when priorities differ', () => {
      jobQueue.enqueue('download', { n: 1 }, { priority: 0 });
      jobQueue.enqueue('download', { n: 2 }, { priority: 10 });
      const job = jobQueue.dequeue();
      expect(JSON.parse(job.payload)).toEqual({ n: 2 });
    });

    it('filters by type when type argument is provided', () => {
      jobQueue.enqueue('download', { n: 1 });
      jobQueue.enqueue('upgrade', { n: 2 });
      const job = jobQueue.dequeue('upgrade');
      expect(job).not.toBeNull();
      expect(job.type).toBe('upgrade');
    });

    it('returns null when no pending jobs match the requested type', () => {
      jobQueue.enqueue('download', { n: 1 });
      const job = jobQueue.dequeue('upgrade');
      expect(job).toBeNull();
    });
  });

  describe('complete', () => {
    it('marks a job as done', () => {
      const id = jobQueue.enqueue('download', { url: 'http://x.com/a.mp3' });
      jobQueue.dequeue();
      jobQueue.complete(id, { file: '/music/a.mp3' });
      const jobs = jobQueue.getByStatus('done');
      expect(jobs.length).toBe(1);
      expect(jobs[0].id).toBe(id);
    });

    it('stores the result as JSON', () => {
      const id = jobQueue.enqueue('download', { url: 'http://x.com/b.mp3' });
      jobQueue.dequeue();
      const result = { file: '/music/b.mp3', duration: 180 };
      jobQueue.complete(id, result);
      const jobs = jobQueue.getByStatus('done');
      expect(JSON.parse(jobs[0].result)).toEqual(result);
    });
  });

  describe('fail', () => {
    it('increments retries on failure', () => {
      const id = jobQueue.enqueue('download', { url: 'http://x.com/c.mp3' }, { maxRetries: 3 });
      jobQueue.dequeue();
      jobQueue.fail(id, 'connection refused');
      const jobs = jobQueue.getAll();
      expect(jobs[0].retries).toBe(1);
    });

    it('resets to pending when retries < max_retries', () => {
      const id = jobQueue.enqueue('download', { url: 'http://x.com/d.mp3' }, { maxRetries: 3 });
      jobQueue.dequeue();
      jobQueue.fail(id, 'timeout');
      expect(jobQueue.getByStatus('pending').length).toBe(1);
      expect(jobQueue.getByStatus('failed').length).toBe(0);
    });

    it('marks permanently failed when retries >= max_retries', () => {
      const id = jobQueue.enqueue('download', { url: 'http://x.com/e.mp3' }, { maxRetries: 2 });

      // Fail up to max_retries
      for (let i = 0; i < 2; i++) {
        jobQueue.dequeue();
        jobQueue.fail(id, 'error');
      }

      expect(jobQueue.getByStatus('failed').length).toBe(1);
      expect(jobQueue.getByStatus('pending').length).toBe(0);
    });

    it('stores the error message in result', () => {
      const id = jobQueue.enqueue('download', { url: 'http://x.com/f.mp3' }, { maxRetries: 1 });
      jobQueue.dequeue();
      jobQueue.fail(id, 'disk full');
      // After 1 failure with maxRetries=1, job is permanently failed
      const jobs = jobQueue.getByStatus('failed');
      expect(jobs.length).toBe(1);
      const result = JSON.parse(jobs[0].result);
      expect(result.error).toBe('disk full');
    });

    it('retries exactly max_retries times before permanent failure (default 3)', () => {
      jobQueue.enqueue('download', { url: 'http://x.com/g.mp3' });
      // Default maxRetries = 3, so 3 attempts before permanent failure
      for (let i = 0; i < 3; i++) {
        const job = jobQueue.dequeue();
        expect(job).not.toBeNull();
        jobQueue.fail(job.id, 'err');
      }
      expect(jobQueue.getByStatus('failed').length).toBe(1);
      expect(jobQueue.getByStatus('pending').length).toBe(0);
    });
  });

  describe('getByType', () => {
    it('returns all jobs of the given type', () => {
      jobQueue.enqueue('download', { n: 1 });
      jobQueue.enqueue('download', { n: 2 });
      jobQueue.enqueue('upgrade', { n: 3 });
      const downloads = jobQueue.getByType('download');
      expect(downloads.length).toBe(2);
      expect(downloads.every(j => j.type === 'download')).toBe(true);
    });

    it('returns empty array when no jobs of that type exist', () => {
      jobQueue.enqueue('download', { n: 1 });
      expect(jobQueue.getByType('validate')).toEqual([]);
    });
  });

  describe('getByStatus', () => {
    it('returns all jobs with the given status', () => {
      jobQueue.enqueue('download', { n: 1 });
      jobQueue.enqueue('download', { n: 2 });
      jobQueue.dequeue(); // one becomes active
      expect(jobQueue.getByStatus('pending').length).toBe(1);
      expect(jobQueue.getByStatus('active').length).toBe(1);
    });

    it('returns empty array when no jobs have that status', () => {
      expect(jobQueue.getByStatus('done')).toEqual([]);
    });
  });

  describe('getAll', () => {
    it('returns all jobs regardless of type or status', () => {
      jobQueue.enqueue('download', { n: 1 });
      jobQueue.enqueue('upgrade', { n: 2 });
      const job = jobQueue.dequeue();
      jobQueue.complete(job.id, {});
      const all = jobQueue.getAll();
      expect(all.length).toBe(2);
    });

    it('returns empty array when no jobs exist', () => {
      expect(jobQueue.getAll()).toEqual([]);
    });
  });

});
