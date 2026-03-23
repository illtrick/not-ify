'use strict';

// Suite — Setup wizard API endpoints

const os = require('os');
const path = require('path');

// Use an isolated temp DB for this test suite
process.env.CONFIG_DIR = path.join(os.tmpdir(), `notify-test-setup-${process.pid}`);

const express = require('express');
const request = require('supertest');
const db = require('../../src/services/db');
const setupMiddleware = require('../../src/middleware/setup');

// Mount router on a minimal express app (setup.js is not yet wired into index.js)
const setupRouter = require('../../src/api/setup');

const app = express();
app.use(express.json());
app.use('/api/setup', setupRouter);

// Clean up between tests
afterEach(() => {
  // Remove all users and reset setup_complete
  try {
    const conn = db.getDb();
    conn.prepare("DELETE FROM users").run();
    conn.prepare("DELETE FROM global_settings").run();
    conn.prepare("DELETE FROM lastfm_config").run();
  } catch {
    // ignore
  }
  setupMiddleware._resetCache();
});

afterAll(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// GET /api/setup/status
// ---------------------------------------------------------------------------

describe('GET /api/setup/status', () => {
  test('needsSetup is true when no users exist', async () => {
    const res = await request(app).get('/api/setup/status').expect(200);
    expect(res.body.needsSetup).toBe(true);
    expect(res.body.userCount).toBe(0);
    expect(res.body.completedSteps).toEqual([]);
  });

  test('needsSetup reflects setup_complete flag once set', async () => {
    // Create a user first so isSetupComplete can return true
    db.createUser('test-user', 'Test User', 'admin');
    db.setGlobalSetting('setup_complete', true);
    setupMiddleware._resetCache();

    const res = await request(app).get('/api/setup/status').expect(200);
    expect(res.body.needsSetup).toBe(false);
    expect(res.body.completedSteps).toContain('complete');
  });

  test('completedSteps includes account when users exist', async () => {
    db.createUser('alice', 'Alice', 'admin');

    const res = await request(app).get('/api/setup/status').expect(200);
    expect(res.body.completedSteps).toContain('account');
    expect(res.body.userCount).toBe(1);
  });

  test('completedSteps includes library when musicDir is configured', async () => {
    db.setGlobalSetting('musicDir', '/some/music');

    const res = await request(app).get('/api/setup/status').expect(200);
    expect(res.body.completedSteps).toContain('library');
  });

  test('completedSteps is empty when nothing is configured', async () => {
    const res = await request(app).get('/api/setup/status').expect(200);
    expect(res.body.completedSteps).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// POST /api/setup/account
// ---------------------------------------------------------------------------

describe('POST /api/setup/account', () => {
  test('creates the first admin user and returns 201', async () => {
    const res = await request(app)
      .post('/api/setup/account')
      .send({ displayName: 'Alice' })
      .expect(201);

    expect(res.body.userId).toBe('alice');
    expect(res.body.displayName).toBe('Alice');
    expect(res.body.isAdmin).toBe(true);
  });

  test('generates userId from displayName (lowercase, hyphenated)', async () => {
    const res = await request(app)
      .post('/api/setup/account')
      .send({ displayName: 'John Doe!' })
      .expect(201);

    expect(res.body.userId).toBe('john-doe');
  });

  test('returns 400 when displayName is missing', async () => {
    const res = await request(app)
      .post('/api/setup/account')
      .send({})
      .expect(400);

    expect(res.body.error).toMatch(/displayName/i);
  });

  test('returns 400 when displayName is empty string', async () => {
    const res = await request(app)
      .post('/api/setup/account')
      .send({ displayName: '   ' })
      .expect(400);

    expect(res.body.error).toMatch(/displayName/i);
  });

  test('returns 409 when a user already exists', async () => {
    db.createUser('existing', 'Existing User', 'admin');

    const res = await request(app)
      .post('/api/setup/account')
      .send({ displayName: 'Bob' })
      .expect(409);

    expect(res.body.error).toBeDefined();
  });

  test('persists the user to the database', async () => {
    await request(app)
      .post('/api/setup/account')
      .send({ displayName: 'Carol' })
      .expect(201);

    expect(db.getUserCount()).toBe(1);
  });

  test('calls setupMiddleware._resetCache after creating user', async () => {
    const spy = jest.spyOn(setupMiddleware, '_resetCache');

    await request(app)
      .post('/api/setup/account')
      .send({ displayName: 'Dave' })
      .expect(201);

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// GET /api/setup/library
// ---------------------------------------------------------------------------

describe('GET /api/setup/library', () => {
  test('returns musicDir info with exists and writable fields', async () => {
    // Use a real temp dir that exists
    const tmpDir = os.tmpdir();
    db.setGlobalSetting('musicDir', tmpDir);

    const res = await request(app).get('/api/setup/library').expect(200);
    expect(res.body.musicDir).toBe(tmpDir);
    expect(typeof res.body.exists).toBe('boolean');
    expect(typeof res.body.writable).toBe('boolean');
  });

  test('exists is false for a non-existent path', async () => {
    db.setGlobalSetting('musicDir', '/nonexistent/path/that/does/not/exist/xyz');

    const res = await request(app).get('/api/setup/library').expect(200);
    expect(res.body.exists).toBe(false);
    expect(res.body.writable).toBe(false);
  });

  test('falls back to /app/music when no musicDir configured', async () => {
    delete process.env.MUSIC_DIR;

    const res = await request(app).get('/api/setup/library').expect(200);
    expect(res.body.musicDir).toBe('/app/music');
  });

  test('uses MUSIC_DIR env var when no DB value', async () => {
    process.env.MUSIC_DIR = '/mnt/music';

    const res = await request(app).get('/api/setup/library').expect(200);
    expect(res.body.musicDir).toBe('/mnt/music');

    delete process.env.MUSIC_DIR;
  });

  test('freeSpace field is present in response', async () => {
    const res = await request(app).get('/api/setup/library').expect(200);
    // freeSpace can be null on unsupported platforms, but key must exist
    expect('freeSpace' in res.body).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/setup/library
// ---------------------------------------------------------------------------

describe('PUT /api/setup/library', () => {
  test('saves a valid directory path', async () => {
    const tmpDir = os.tmpdir();
    const res = await request(app)
      .put('/api/setup/library')
      .send({ musicDir: tmpDir })
      .expect(200);

    expect(res.body.saved).toBe(true);
    expect(res.body.musicDir).toBe(path.resolve(tmpDir));
  });

  test('returns 400 when musicDir is missing', async () => {
    const res = await request(app)
      .put('/api/setup/library')
      .send({})
      .expect(400);

    expect(res.body.error).toMatch(/musicDir/i);
  });

  test('returns 400 when path does not exist', async () => {
    const res = await request(app)
      .put('/api/setup/library')
      .send({ musicDir: '/nonexistent/path/xyz/abc' })
      .expect(400);

    expect(res.body.error).toMatch(/does not exist/i);
  });

  test('persists the path to the database', async () => {
    const tmpDir = os.tmpdir();
    await request(app)
      .put('/api/setup/library')
      .send({ musicDir: tmpDir })
      .expect(200);

    expect(db.getGlobalSetting('musicDir')).toBe(path.resolve(tmpDir));
  });
});

// ---------------------------------------------------------------------------
// GET /api/setup/services
// ---------------------------------------------------------------------------

describe('GET /api/setup/services', () => {
  test('returns array of four service objects', async () => {
    const res = await request(app).get('/api/setup/services').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(4);
  });

  test('each service has name, label, configured, connected fields', async () => {
    const res = await request(app).get('/api/setup/services').expect(200);
    for (const svc of res.body) {
      expect(svc).toHaveProperty('name');
      expect(svc).toHaveProperty('label');
      expect(svc).toHaveProperty('configured');
      expect(svc).toHaveProperty('connected');
    }
  });

  test('services are unconfigured by default', async () => {
    const res = await request(app).get('/api/setup/services').expect(200);
    for (const svc of res.body) {
      expect(svc.configured).toBe(false);
    }
  });

  test('realdebrid shows configured when token is set', async () => {
    db.setGlobalSetting('realDebridToken', 'my-token-abc');

    const res = await request(app).get('/api/setup/services').expect(200);
    const rd = res.body.find(s => s.name === 'realdebrid');
    expect(rd.configured).toBe(true);
  });

  test('vpn shows configured when vpnConfig has username', async () => {
    db.setGlobalSetting('vpnConfig', { username: 'vpnuser', password: 'secret' });

    const res = await request(app).get('/api/setup/services').expect(200);
    const vpn = res.body.find(s => s.name === 'vpn');
    expect(vpn.configured).toBe(true);
  });

  test('soulseek shows configured when soulseekConfig has username', async () => {
    db.setGlobalSetting('soulseekConfig', { username: 'slskuser', password: 'slskpass' });

    const res = await request(app).get('/api/setup/services').expect(200);
    const slsk = res.body.find(s => s.name === 'soulseek');
    expect(slsk.configured).toBe(true);
  });

  test('includes all expected service names', async () => {
    const res = await request(app).get('/api/setup/services').expect(200);
    const names = res.body.map(s => s.name);
    expect(names).toContain('lastfm');
    expect(names).toContain('realdebrid');
    expect(names).toContain('vpn');
    expect(names).toContain('soulseek');
  });
});

// ---------------------------------------------------------------------------
// POST /api/setup/complete
// ---------------------------------------------------------------------------

describe('POST /api/setup/complete', () => {
  test('marks setup as complete when a user exists', async () => {
    db.createUser('admin-user', 'Admin User', 'admin');

    const res = await request(app).post('/api/setup/complete').expect(200);
    expect(res.body.complete).toBe(true);
  });

  test('returns 400 when no users exist', async () => {
    const res = await request(app).post('/api/setup/complete').expect(400);
    expect(res.body.error).toBeDefined();
  });

  test('persists setup_complete flag in the database', async () => {
    db.createUser('admin-user', 'Admin User', 'admin');

    await request(app).post('/api/setup/complete').expect(200);

    expect(db.getGlobalSetting('setup_complete')).toBe(true);
  });

  test('calls setupMiddleware._markComplete', async () => {
    db.createUser('admin-user', 'Admin User', 'admin');
    const spy = jest.spyOn(setupMiddleware, '_markComplete');

    await request(app).post('/api/setup/complete').expect(200);

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
