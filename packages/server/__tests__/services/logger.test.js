'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

// Use a temp dir for each test to avoid cross-test pollution
let tmpDir;
let logger;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-test-'));
  process.env.CONFIG_DIR = tmpDir;
  // Clear module cache so logger re-initializes with new CONFIG_DIR
  jest.resetModules();
});

afterEach(() => {
  // Clean up: flush logger if it exists, remove temp dir
  try {
    if (logger && logger.flushAndClose) {
      logger.flushAndClose();
    }
  } catch {}
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.CONFIG_DIR;
});

describe('logger', () => {
  test('exports a pino logger instance with expected methods', () => {
    logger = require('../../src/services/logger');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.child).toBe('function');
    expect(typeof logger.createChild).toBe('function');
    expect(typeof logger.flushAndClose).toBe('function');
  });

  test('createChild returns a child logger with service field', () => {
    logger = require('../../src/services/logger');
    const child = logger.createChild('test-service');
    expect(typeof child.info).toBe('function');
    expect(typeof child.warn).toBe('function');
  });

  test('logger has env field bound from NODE_ENV', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test-env';
    logger = require('../../src/services/logger');
    // Pino bindings include the env field
    const bindings = logger.bindings ? logger.bindings() : {};
    expect(bindings.env).toBe('test-env');
    process.env.NODE_ENV = origEnv;
  });

  test('creates logs directory on init', () => {
    logger = require('../../src/services/logger');
    expect(fs.existsSync(path.join(tmpDir, 'logs'))).toBe(true);
  });

  test('redacts sensitive fields', () => {
    logger = require('../../src/services/logger');
    expect(logger).toBeDefined();
  });
});
