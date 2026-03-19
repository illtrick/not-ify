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

  test('POST /test calls getUserInfo and returns user info', async () => {
    rd.getUserInfo.mockResolvedValue({
      username: 'testuser', email: 'test@test.com',
      type: 'premium', premium: 1, expiration: '2026-08-15T00:00:00.000Z',
    });
    const res = await request(app).post('/api/realdebrid/test').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.user.username).toBe('testuser');
  });

  test('POST /test returns error on failure', async () => {
    rd.getUserInfo.mockRejectedValue(new Error('Invalid token'));
    const res = await request(app).post('/api/realdebrid/test').expect(200);
    expect(res.body.status).toBe('error');
    expect(res.body.error).toContain('Invalid token');
  });
});
