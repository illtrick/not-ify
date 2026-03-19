const express = require('express');
const request = require('supertest');
const db = require('../../src/services/db');

const vpnConfigRouter = require('../../src/api/vpn-config');

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.userId = 'test-admin'; next(); });
app.use('/api/vpn', vpnConfigRouter);

beforeAll(() => db.setGlobalSetting('vpnConfig', null));
afterAll(() => db.close());

describe('VPN config API', () => {
  test('GET /status returns not configured initially', () => {
    return request(app).get('/api/vpn/status')
      .expect(200)
      .then(res => {
        expect(res.body.configured).toBe(false);
      });
  });

  test('POST /config saves credentials and region', () => {
    return request(app).post('/api/vpn/config')
      .send({ username: 'piauser', password: 'piapass', region: 'US East' })
      .expect(200)
      .then(res => {
        expect(res.body.saved).toBe(true);
      });
  });

  test('GET /status shows configured after save, never exposes password', () => {
    return request(app).get('/api/vpn/status')
      .expect(200)
      .then(res => {
        expect(res.body.configured).toBe(true);
        expect(res.body.region).toBe('US East');
        expect(res.body.username).toBe('piauser');
        expect(res.body.password).toBeUndefined();
      });
  });

  test('GET /regions returns PIA region list', () => {
    return request(app).get('/api/vpn/regions')
      .expect(200)
      .then(res => {
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(5);
        expect(res.body).toContain('US East');
      });
  });

  test('POST /test returns proxy_unavailable in dev (no VPN_PROXY env)', async () => {
    const res = await request(app).post('/api/vpn/test').expect(200);
    expect(res.body.status).toBe('proxy_unavailable');
  });
});
