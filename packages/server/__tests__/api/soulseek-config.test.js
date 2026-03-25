const os = require('os');
const path = require('path');
process.env.CONFIG_DIR = path.join(os.tmpdir(), `notify-test-${process.pid}`);
const express = require('express');
const request = require('supertest');
const db = require('../../src/services/db');

// Mock global fetch used by status and test endpoints
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
  test('GET /status returns not configured initially', async () => {
    // Mock fetch to simulate slskd unavailable
    global.fetch.mockRejectedValue(new Error('unavailable'));
    const res = await request(app).get('/api/soulseek/status').expect(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.username).toBeNull();
    expect(res.body.connected).toBe(false);
  });

  test('POST /config returns 400 when username is missing', async () => {
    const res = await request(app).post('/api/soulseek/config')
      .send({ password: 'secret' }).expect(400);
    expect(res.body.error).toMatch(/Missing/);
  });

  test('POST /config returns 400 when password is missing', async () => {
    const res = await request(app).post('/api/soulseek/config')
      .send({ username: 'testuser' }).expect(400);
    expect(res.body.error).toMatch(/Missing/);
  });

  test('POST /config saves credentials and pushes to slskd', async () => {
    // Mock the PATCH to slskd
    global.fetch.mockResolvedValue({ ok: true });

    const res = await request(app).post('/api/soulseek/config')
      .send({ username: 'testuser', password: 'testpass' }).expect(200);
    expect(res.body.saved).toBe(true);
    expect(res.body.slskdSync).toBe(true);

    // Verify PATCH was called with correct data
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v0/options'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ soulseek: { username: 'testuser', password: 'testpass' } }),
      }),
    );
  });

  test('POST /config saves to DB even if slskd push fails', async () => {
    global.fetch.mockRejectedValue(new Error('connection refused'));

    const res = await request(app).post('/api/soulseek/config')
      .send({ username: 'testuser2', password: 'testpass2' }).expect(200);
    expect(res.body.saved).toBe(true);
    expect(res.body.slskdSync).toBe(false);

    // Verify DB was updated
    const config = db.getGlobalSetting('soulseekConfig');
    expect(config.username).toBe('testuser2');
  });

  test('GET /status shows configured after save', async () => {
    // Mock fetch for live status check
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ server: { isConnected: true, state: 'Connected, LoggedIn' } }),
    });

    const res = await request(app).get('/api/soulseek/status').expect(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.username).toBe('testuser2');
    expect(res.body.connected).toBe(true);
    expect(res.body.state).toBe('Connected, LoggedIn');
    // Never expose password
    expect(res.body.password).toBeUndefined();
  });

  test('POST /test returns ok with connection details', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        server: { isConnected: true, state: 'Connected, LoggedIn' },
        user: { username: 'testuser2' },
        version: { current: '0.24.5' },
      }),
    });

    const res = await request(app).post('/api/soulseek/test').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.isConnected).toBe(true);
    expect(res.body.username).toBe('testuser2');
    expect(res.body.version).toBe('0.24.5');
  });

  test('POST /test returns error on network failure', async () => {
    global.fetch.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const res = await request(app).post('/api/soulseek/test').expect(200);
    expect(res.body.status).toBe('error');
    expect(res.body.error).toContain('ECONNREFUSED');
  });
});
