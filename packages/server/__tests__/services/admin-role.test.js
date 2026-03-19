const os = require('os');
const path = require('path');
process.env.CONFIG_DIR = path.join(os.tmpdir(), `notify-test-${process.pid}`);
const db = require('../../src/services/db');

afterAll(() => db.close());

describe('admin role', () => {
  test('isAdmin returns true for admin user', () => {
    db.getDb().prepare("INSERT OR REPLACE INTO users (id, display_name, role) VALUES (?, ?, ?)").run('test-admin', 'Admin', 'admin');
    expect(db.isAdmin('test-admin')).toBe(true);
  });

  test('isAdmin returns false for regular user', () => {
    db.getDb().prepare("INSERT OR REPLACE INTO users (id, display_name, role) VALUES (?, ?, ?)").run('test-user', 'User', 'user');
    expect(db.isAdmin('test-user')).toBe(false);
  });

  test('isAdmin returns false for unknown user', () => {
    expect(db.isAdmin('nonexistent')).toBe(false);
  });

  test('getUsers includes role field', () => {
    const users = db.getUsers();
    const admin = users.find(u => u.id === 'test-admin');
    expect(admin).toBeDefined();
    expect(admin.role).toBe('admin');
  });
});
