const os = require('os');
const path = require('path');
process.env.CONFIG_DIR = path.join(os.tmpdir(), `notify-test-${process.pid}`);
const express = require('express');
const request = require('supertest');
const db = require('../../src/services/db');

// Mock global fetch used by the test endpoint
global.fetch = jest.fn();

const soulseekConfigRouter = require('../../src/api/soulseek-config');

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.userId = 'test-admin'; next(); });
app.use('/api/soulseek', soulseekConfigRouter);

beforeAll(() => db.setGlobalSetting('soulseekConfig', null));
afterAll(() => db.close());
afterEach(() => jest.clearAllMocks());

describe('Soulseek config API', () => {
  test('GET /status returns not configured initially', () => {
    return request(app).get('/api/soulseek/status')
      .expect(200)
      .then(res => {
        expect(res.body.configured).toBe(false);
        expect(res.body.urlPreview).toBeNull();
      });
  });

  test('POST /config returns 400 when url is missing', () => {
    return request(app).post('/api/soulseek/config')
      .send({ apiKey: 'some-key' })
      .expect(400)
      .then(res => {
        expect(res.body.error).toMatch(/Missing/);
      });
  });

  test('POST /config returns 400 when apiKey is missing', () => {
    return request(app).post('/api/soulseek/config')
      .send({ url: 'http://localhost:5030' })
      .expect(400)
      .then(res => {
        expect(res.body.error).toMatch(/Missing/);
      });
  });

  test('POST /config saves url and apiKey', () => {
    return request(app).post('/api/soulseek/config')
      .send({ url: 'http://localhost:5030', apiKey: 'test-key-abc' })
      .expect(200)
      .then(res => {
        expect(res.body.saved).toBe(true);
      });
  });

  test('GET /status shows configured after save, never exposes apiKey', () => {
    return request(app).get('/api/soulseek/status')
      .expect(200)
      .then(res => {
        expect(res.body.configured).toBe(true);
        expect(res.body.urlPreview).toBe('http://localhost:5030');
        expect(res.body.apiKey).toBeUndefined();
      });
  });

  test('POST /test returns ok with connection details on success', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ isConnected: true, state: 'Connected', version: '0.21.0' }),
    });

    const res = await request(app).post('/api/soulseek/test').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.isConnected).toBe(true);
    expect(res.body.state).toBe('Connected');
    expect(res.body.version).toBe('0.21.0');

    // Verify the correct endpoint and API key header were used
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:5030/api/v0/server',
      expect.objectContaining({ headers: { 'X-API-Key': 'test-key-abc' } }),
    );
  });

  test('POST /test returns error when slskd returns non-OK status', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 403 });

    const res = await request(app).post('/api/soulseek/test').expect(200);
    expect(res.body.status).toBe('error');
    expect(res.body.error).toContain('403');
  });

  test('POST /test returns error on network failure', async () => {
    global.fetch.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const res = await request(app).post('/api/soulseek/test').expect(200);
    expect(res.body.status).toBe('error');
    expect(res.body.error).toContain('ECONNREFUSED');
  });

  test('POST /test returns error when not configured', async () => {
    // Clear config
    db.setGlobalSetting('soulseekConfig', null);

    const res = await request(app).post('/api/soulseek/test').expect(200);
    expect(res.body.status).toBe('error');
    expect(res.body.error).toMatch(/Not configured/);
  });
});
