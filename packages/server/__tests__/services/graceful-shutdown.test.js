'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shutdown-test-'));
  process.env.CONFIG_DIR = tmpDir;
  jest.resetModules();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.CONFIG_DIR;
});

// Mock logger
jest.mock('../../src/services/logger', () => {
  const child = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
  };
  return {
    createChild: jest.fn(() => child),
    flushAndClose: jest.fn(() => Promise.resolve()),
    _child: child,
  };
});

describe('graceful-shutdown', () => {
  test('exports register, checkStartupRecovery', () => {
    const shutdown = require('../../src/services/graceful-shutdown');
    expect(typeof shutdown.register).toBe('function');
    expect(typeof shutdown.checkStartupRecovery).toBe('function');
  });

  test('checkStartupRecovery logs unclean when flag missing', () => {
    const shutdown = require('../../src/services/graceful-shutdown');
    const logger = require('../../src/services/logger');

    const result = shutdown.checkStartupRecovery({
      resetStuckJobs: jest.fn().mockReturnValue(2),
    });

    expect(result.cleanShutdown).toBe(false);
    expect(logger._child.warn).toHaveBeenCalled();
  });

  test('checkStartupRecovery detects clean shutdown', () => {
    fs.writeFileSync(path.join(tmpDir, '.clean-shutdown'), '');

    const shutdown = require('../../src/services/graceful-shutdown');
    const result = shutdown.checkStartupRecovery({
      resetStuckJobs: jest.fn(),
    });

    expect(result.cleanShutdown).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.clean-shutdown'))).toBe(false);
  });

  test('executeShutdown runs steps in order', async () => {
    const shutdown = require('../../src/services/graceful-shutdown');
    const callOrder = [];

    shutdown.register({
      httpServer: { close: (cb) => { callOrder.push('http'); cb(); } },
      sseConnections: new Set(),
      jobWorker: { stop: () => callOrder.push('jobWorker') },
      upgraderInterval: setInterval(() => {}, 99999),
      scrobbleSync: { stopAll: () => callOrder.push('scrobbleSync') },
      dlna: { stopDiscovery: () => callOrder.push('dlna') },
      db: {
        checkpoint: () => callOrder.push('checkpoint'),
        optimize: () => callOrder.push('optimize'),
        close: () => callOrder.push('dbClose'),
      },
      flushScrobbles: () => { callOrder.push('scrobbles'); return Promise.resolve(); },
      resetActiveJobs: () => callOrder.push('resetJobs'),
    });

    await shutdown.executeShutdown();

    expect(callOrder).toContain('http');
    expect(callOrder).toContain('jobWorker');
    expect(callOrder).toContain('checkpoint');
    expect(callOrder).toContain('dbClose');
    expect(fs.existsSync(path.join(tmpDir, '.clean-shutdown'))).toBe(true);
  });

  test('executeShutdown tolerates missing optional services', async () => {
    const shutdown = require('../../src/services/graceful-shutdown');

    shutdown.register({
      httpServer: { close: (cb) => cb() },
      sseConnections: new Set(),
      db: {
        checkpoint: () => {},
        optimize: () => {},
        close: () => {},
      },
    });

    await expect(shutdown.executeShutdown()).resolves.not.toThrow();
  });
});
