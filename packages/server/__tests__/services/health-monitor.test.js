'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-test-'));
  process.env.CONFIG_DIR = tmpDir;
  jest.resetModules();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.CONFIG_DIR;
});

// Mock logger to capture log calls
jest.mock('../../src/services/logger', () => {
  const calls = [];
  const child = {
    info: jest.fn((...args) => calls.push({ level: 'info', args })),
    warn: jest.fn((...args) => calls.push({ level: 'warn', args })),
    error: jest.fn((...args) => calls.push({ level: 'error', args })),
    fatal: jest.fn((...args) => calls.push({ level: 'fatal', args })),
  };
  const mock = {
    createChild: jest.fn(() => child),
    _child: child,
    _calls: calls,
  };
  return mock;
});

describe('health-monitor', () => {
  test('exports start, stop, getSnapshot', () => {
    const monitor = require('../../src/services/health-monitor');
    expect(typeof monitor.start).toBe('function');
    expect(typeof monitor.stop).toBe('function');
    expect(typeof monitor.getSnapshot).toBe('function');
  });

  test('getSnapshot returns health data', () => {
    const monitor = require('../../src/services/health-monitor');
    const snap = monitor.getSnapshot();
    expect(snap).toHaveProperty('memory');
    expect(snap).toHaveProperty('uptime');
    expect(snap.memory).toHaveProperty('heapUsed');
    expect(snap.memory).toHaveProperty('rss');
  });

  test('start and stop do not throw', () => {
    const monitor = require('../../src/services/health-monitor');
    expect(() => monitor.start()).not.toThrow();
    expect(() => monitor.stop()).not.toThrow();
  });

  test('runStartupBenchmark returns timing data', async () => {
    const monitor = require('../../src/services/health-monitor');
    const result = await monitor.runStartupBenchmark({
      benchmark: () => ({ duration: 5 }),
      getWalSize: () => 1024,
    });
    expect(result).toHaveProperty('sqliteBenchmark');
    expect(result).toHaveProperty('fsBenchmark');
    expect(result).toHaveProperty('platform');
    expect(result).toHaveProperty('cpuModel');
  });
});
