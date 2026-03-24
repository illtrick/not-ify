'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

let tmpDir;

// Mock logger before requiring db
jest.mock('../../src/services/logger', () => {
  const child = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  return {
    createChild: jest.fn(() => child),
    _child: child,
  };
});

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-timing-'));
  process.env.CONFIG_DIR = tmpDir;
  jest.resetModules();
});

afterEach(() => {
  try {
    const db = require('../../src/services/db');
    db.close();
  } catch {}
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.CONFIG_DIR;
});

describe('db timing and new methods', () => {
  test('benchmark returns duration in ms', () => {
    const db = require('../../src/services/db');
    const result = db.benchmark();
    expect(result).toHaveProperty('duration');
    expect(typeof result.duration).toBe('number');
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  test('getWalSize returns a number', () => {
    const db = require('../../src/services/db');
    const size = db.getWalSize();
    expect(typeof size).toBe('number');
    expect(size).toBeGreaterThanOrEqual(0);
  });

  test('existing db functions still work after timing wrapper', () => {
    const db = require('../../src/services/db');
    const user = db.createUser('test-user', 'Test');
    expect(user).toBeDefined();
    const users = db.getUsers();
    expect(users.length).toBeGreaterThan(0);
    db.setGlobalSetting('testKey', 'testVal');
    expect(db.getGlobalSetting('testKey')).toBe('testVal');
  });

  test('close shuts down the database cleanly', () => {
    const db = require('../../src/services/db');
    db.getUsers();
    expect(() => db.close()).not.toThrow();
  });
});
