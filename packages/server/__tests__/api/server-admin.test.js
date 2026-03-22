'use strict';

const os = require('os');
const path = require('path');
process.env.CONFIG_DIR = path.join(os.tmpdir(), `notify-test-server-admin-${process.pid}`);

const express = require('express');
const request = require('supertest');

// Mock job-queue so we control active job results
jest.mock('../../src/services/job-queue', () => ({
  getByStatus: jest.fn(),
}));

// Mock activity-log so we don't pollute logs and can assert calls
jest.mock('../../src/services/activity-log', () => ({
  log: jest.fn(),
}));

// Mock db.getDb to provide a minimal SQLite-like interface for the restart path
const mockRun = jest.fn();
const mockPrepare = jest.fn(() => ({ run: mockRun }));
jest.mock('../../src/services/db', () => ({
  getDb: jest.fn(() => ({ prepare: mockPrepare })),
  isAdmin: jest.fn().mockReturnValue(true),
  close: jest.fn(),
}));

// Capture process.exit so the test process is not killed
const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

const jobQueue = require('../../src/services/job-queue');
const activity = require('../../src/services/activity-log');
const serverAdminRouter = require('../../src/api/server-admin');

const app = express();
app.use(express.json());
app.use('/api/server', serverAdminRouter);

afterEach(() => {
  jest.clearAllMocks();
});

afterAll(() => {
  exitSpy.mockRestore();
});

describe('GET /api/server/active-jobs', () => {
  test('returns zero count and empty types when no active jobs', async () => {
    jobQueue.getByStatus.mockReturnValue([]);
    const res = await request(app).get('/api/server/active-jobs').expect(200);
    expect(res.body).toEqual({ activeJobs: 0, types: [] });
    expect(jobQueue.getByStatus).toHaveBeenCalledWith('active');
  });

  test('returns correct count and deduplicated types', async () => {
    jobQueue.getByStatus.mockReturnValue([
      { id: 1, type: 'download', status: 'active' },
      { id: 2, type: 'download', status: 'active' },
      { id: 3, type: 'upgrade', status: 'active' },
    ]);
    const res = await request(app).get('/api/server/active-jobs').expect(200);
    expect(res.body.activeJobs).toBe(3);
    expect(res.body.types).toEqual(expect.arrayContaining(['download', 'upgrade']));
    expect(res.body.types).toHaveLength(2);
  });
});

describe('POST /api/server/restart', () => {
  test('responds with restarting: true', async () => {
    jobQueue.getByStatus.mockReturnValue([]);
    const res = await request(app).post('/api/server/restart').expect(200);
    expect(res.body).toEqual({ restarting: true });
  });

  test('logs restart to activity log', async () => {
    jobQueue.getByStatus.mockReturnValue([]);
    await request(app).post('/api/server/restart').expect(200);
    expect(activity.log).toHaveBeenCalledWith('system', 'info', 'Server restarting for config change', expect.objectContaining({ pausedJobs: 0 }));
  });

  test('calls process.exit(0)', async () => {
    jobQueue.getByStatus.mockReturnValue([]);
    await request(app).post('/api/server/restart').expect(200);
    // setImmediate is used — wait a tick
    await new Promise(r => setImmediate(r));
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test('resets active jobs to pending before exiting', async () => {
    jobQueue.getByStatus.mockReturnValue([
      { id: 10, type: 'download', status: 'active' },
      { id: 11, type: 'upgrade', status: 'active' },
    ]);
    await request(app).post('/api/server/restart').expect(200);
    await new Promise(r => setImmediate(r));

    expect(mockPrepare).toHaveBeenCalledWith(
      "UPDATE jobs SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'"
    );
    expect(mockRun).toHaveBeenCalledWith(10);
    expect(mockRun).toHaveBeenCalledWith(11);
  });

  test('does not touch db when no active jobs', async () => {
    jobQueue.getByStatus.mockReturnValue([]);
    await request(app).post('/api/server/restart').expect(200);
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  test('logs pausedJobs count matching active jobs', async () => {
    jobQueue.getByStatus.mockReturnValue([
      { id: 20, type: 'download', status: 'active' },
    ]);
    await request(app).post('/api/server/restart').expect(200);
    expect(activity.log).toHaveBeenCalledWith(
      'system', 'info', 'Server restarting for config change',
      { pausedJobs: 1 }
    );
  });
});
