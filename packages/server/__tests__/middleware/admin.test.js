const express = require('express');
const request = require('supertest');
const db = require('../../src/services/db');
const adminGuard = require('../../src/middleware/admin');

const app = express();
app.use((req, res, next) => { req.userId = req.headers['x-user-id'] || 'default'; next(); });
app.get('/admin-only', adminGuard, (req, res) => res.json({ ok: true }));

afterAll(() => db.close());

describe('admin middleware', () => {
  beforeAll(() => {
    db.getDb().prepare("INSERT OR REPLACE INTO users (id, display_name, role) VALUES (?, ?, ?)").run('adm', 'Admin', 'admin');
    db.getDb().prepare("INSERT OR REPLACE INTO users (id, display_name, role) VALUES (?, ?, ?)").run('usr', 'User', 'user');
  });

  test('allows admin users', () => {
    return request(app).get('/admin-only').set('X-User-Id', 'adm').expect(200);
  });

  test('blocks non-admin users with 403', () => {
    return request(app).get('/admin-only').set('X-User-Id', 'usr').expect(403);
  });
});
