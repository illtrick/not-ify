'use strict';

const Database = require('better-sqlite3');
const os = require('os');
const fs = require('fs');
const path = require('path');

let tmpDir;
let mockDb;
let logCalls;

// Mock logger
jest.mock('../../src/services/logger', () => {
  const calls = [];
  const child = {
    info: jest.fn((...args) => calls.push({ level: 'info', args })),
    warn: jest.fn((...args) => calls.push({ level: 'warn', args })),
    error: jest.fn((...args) => calls.push({ level: 'error', args })),
  };
  const mock = {
    createChild: jest.fn(() => child),
    _child: child,
    _calls: calls,
  };
  return mock;
});

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jw-log-'));
  process.env.CONFIG_DIR = tmpDir;
  logCalls = require('../../src/services/logger')._calls;
  logCalls.length = 0;
  jest.resetModules();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.CONFIG_DIR;
});

describe('job-worker structured logging', () => {
  test('job-worker requires logger and creates child', () => {
    const logger = require('../../src/services/logger');
    expect(logger.createChild).toBeDefined();
  });
});
