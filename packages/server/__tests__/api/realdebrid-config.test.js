const os = require('os');
const path = require('path');
process.env.CONFIG_DIR = path.join(os.tmpdir(), `notify-test-${process.pid}`);
const express = require('express');
const request = require('supertest');
const db = require('../../src/services/db');

jest.mock('../../src/services/realdebrid', () => ({
  getUserInfo: jest.fn(),
  setToken: jest.fn(),
}));

const rd = require('../../src/services/realdebrid');
const rdConfigRouter = require('../../src/api/realdebrid-config');

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.userId = 'test-admin'; next(); });
app.use('/api/realdebrid', rdConfigRouter);

beforeAll(() => db.setGlobalSetting('realDebridToken', null));
afterAll(() => db.close());

describe('Real-Debrid config API', () => {
  test('GET /status returns not_configured when no token', () => {
    return request(app).get('/api/realdebrid/status')
      .expect(200)
      .then(res => {
        expect(res.body.configured).toBe(false);
      });
  });

  test('POST /config saves token', () => {
    return request(app).post('/api/realdebrid/config')
      .send({ apiToken: 'test-token-123' })
      .expect(200)
      .then(res => {
        expect(res.body.saved).toBe(true);
      });
  });

  test('GET /status returns configured after save, never exposes full token', () => {
    return request(app).get('/api/realdebrid/status')
      .expect(200)
      .then(res => {
        expect(res.body.configured).toBe(true);
        expect(res.body.token).toBeUndefined();
        expect(res.body.tokenPreview).toMatch(/^test-t\.\.\.123$/);
      });
  });

  test('POST /test calls RD API directly and returns user info', async () => {
    // Mock global fetch — test endpoint uses direct fetch, not proxy
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        username: 'testuser', email: 'test@test.com',
        type: 'premium', premium: 1, expiration: '2026-08-15T00:00:00.000Z',
      }),
    });
    try {
      const res = await request(app).post('/api/realdebrid/test').expect(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.user.username).toBe('testuser');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('api.real-debrid.com'),
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token-123' }) }),
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('POST /test returns error on API failure', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Invalid token'),
    });
    try {
      const res = await request(app).post('/api/realdebrid/test').expect(200);
      expect(res.body.status).toBe('error');
      expect(res.body.error).toContain('401');
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('POST /test returns error when no token configured', async () => {
    db.setGlobalSetting('realDebridToken', null);
    const res = await request(app).post('/api/realdebrid/test').expect(200);
    expect(res.body.status).toBe('error');
    expect(res.body.error).toContain('No API token');
    // Restore token for other tests
    db.setGlobalSetting('realDebridToken', 'test-token-123');
  });
});
