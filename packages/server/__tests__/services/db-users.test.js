'use strict';

const os = require('os');
const path = require('path');
process.env.CONFIG_DIR = path.join(os.tmpdir(), `notify-test-db-users-${process.pid}`);

const db = require('../../src/services/db');

afterAll(() => db.close());

describe('user management', () => {
  beforeEach(() => {
    const d = db.getDb();
    d.prepare("DELETE FROM users").run();
    d.prepare("DELETE FROM global_settings WHERE key = 'setup_complete'").run();
  });

  test('getUserCount returns 0 on empty DB', () => {
    expect(db.getUserCount()).toBe(0);
  });

  test('createUser creates a user with given role', () => {
    const user = db.createUser('testadmin', 'Test Admin', 'admin');
    expect(user).toEqual({ id: 'testadmin', displayName: 'Test Admin', role: 'admin' });
    expect(db.getUserCount()).toBe(1);
    expect(db.isAdmin('testadmin')).toBe(true);
  });

  test('createUser defaults to user role', () => {
    db.createUser('testuser', 'Test User');
    expect(db.isAdmin('testuser')).toBe(false);
  });

  test('getDefaultUserId returns first non-default user', () => {
    expect(db.getDefaultUserId()).toBeNull();
    db.createUser('alice', 'Alice', 'admin');
    db.createUser('bob', 'Bob');
    expect(db.getDefaultUserId()).toBe('alice');
  });

  test('getDefaultUserId skips default user', () => {
    const d = db.getDb();
    d.prepare("INSERT OR IGNORE INTO users (id, display_name) VALUES ('default', 'Default')").run();
    expect(db.getDefaultUserId()).toBeNull();
    db.createUser('real', 'Real User', 'admin');
    expect(db.getDefaultUserId()).toBe('real');
  });

  test('isSetupComplete returns false with no users', () => {
    expect(db.isSetupComplete()).toBe(false);
  });

  test('isSetupComplete returns true when users exist', () => {
    db.createUser('someone', 'Someone', 'admin');
    expect(db.isSetupComplete()).toBe(true);
  });

  test('isSetupComplete returns true when setup_complete flag set', () => {
    db.setGlobalSetting('setup_complete', true);
    expect(db.isSetupComplete()).toBe(true);
    db.setGlobalSetting('setup_complete', null);
  });
});
