const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.CONFIG_DIR = path.join(os.tmpdir(), `notify-test-libcfg-${process.pid}`);

const express = require('express');
const request = require('supertest');
const db = require('../../src/services/db');
const libraryConfigRouter = require('../../src/api/library-config');

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.userId = 'test-admin'; next(); });
app.use('/api/library-config', libraryConfigRouter);

// A real writable temp directory for testing POST /
const TEST_MUSIC_DIR = path.join(os.tmpdir(), `notify-music-test-${process.pid}`);

beforeAll(() => {
  fs.mkdirSync(TEST_MUSIC_DIR, { recursive: true });
  db.setGlobalSetting('musicDir', null);
  // Ensure MUSIC_DIR env var is cleared so source logic is predictable
  delete process.env.MUSIC_DIR;
});

afterAll(() => {
  try { fs.rmSync(TEST_MUSIC_DIR, { recursive: true, force: true }); } catch {}
  db.close();
});

afterEach(() => {
  db.setGlobalSetting('musicDir', null);
  delete process.env.MUSIC_DIR;
});

describe('Library config API', () => {
  describe('GET /api/library-config', () => {
    test('returns default source when no DB value and no env var', async () => {
      const res = await request(app).get('/api/library-config').expect(200);
      expect(res.body.musicDir).toBe('/app/music');
      expect(res.body.source).toBe('default');
      expect(typeof res.body.isDocker).toBe('boolean');
    });

    test('returns env source when MUSIC_DIR env var is set', async () => {
      process.env.MUSIC_DIR = '/mnt/media/music';
      const res = await request(app).get('/api/library-config').expect(200);
      expect(res.body.musicDir).toBe('/mnt/media/music');
      expect(res.body.source).toBe('env');
    });

    test('returns db source when musicDir is saved in DB', async () => {
      db.setGlobalSetting('musicDir', '/saved/music');
      const res = await request(app).get('/api/library-config').expect(200);
      expect(res.body.musicDir).toBe('/saved/music');
      expect(res.body.source).toBe('db');
    });

    test('DB value takes priority over env var', async () => {
      process.env.MUSIC_DIR = '/env/music';
      db.setGlobalSetting('musicDir', '/db/music');
      const res = await request(app).get('/api/library-config').expect(200);
      expect(res.body.musicDir).toBe('/db/music');
      expect(res.body.source).toBe('db');
    });
  });

  describe('POST /api/library-config', () => {
    test('returns 400 when musicDir is missing', async () => {
      const res = await request(app).post('/api/library-config').send({}).expect(400);
      expect(res.body.error).toMatch(/Missing or invalid/);
    });

    test('returns 400 when path does not exist', async () => {
      const res = await request(app)
        .post('/api/library-config')
        .send({ musicDir: '/nonexistent/path/that/does/not/exist' })
        .expect(400);
      expect(res.body.error).toMatch(/does not exist/);
    });

    test('returns 400 when path is a file, not a directory', async () => {
      const testFile = path.join(TEST_MUSIC_DIR, 'notadir.txt');
      fs.writeFileSync(testFile, 'hello');
      const res = await request(app)
        .post('/api/library-config')
        .send({ musicDir: testFile })
        .expect(400);
      expect(res.body.error).toMatch(/not a directory/);
      fs.unlinkSync(testFile);
    });

    test('saves a valid writable directory and returns saved=true', async () => {
      const res = await request(app)
        .post('/api/library-config')
        .send({ musicDir: TEST_MUSIC_DIR })
        .expect(200);
      expect(res.body.saved).toBe(true);
      expect(res.body.restartRequired).toBe(true);
      expect(res.body.newPath).toBe(path.resolve(TEST_MUSIC_DIR));
      expect(res.body.oldPath).toBeDefined();
    });

    test('persists the new path to the DB', async () => {
      await request(app)
        .post('/api/library-config')
        .send({ musicDir: TEST_MUSIC_DIR })
        .expect(200);
      const saved = db.getGlobalSetting('musicDir');
      expect(saved).toBe(path.resolve(TEST_MUSIC_DIR));
    });

    test('oldPath reflects the previously configured value', async () => {
      db.setGlobalSetting('musicDir', '/old/music/path');
      const res = await request(app)
        .post('/api/library-config')
        .send({ musicDir: TEST_MUSIC_DIR })
        .expect(200);
      expect(res.body.oldPath).toBe('/old/music/path');
    });
  });

  describe('GET /api/library-config/browse', () => {
    test('lists subdirectories of a valid path', async () => {
      const subDir = path.join(TEST_MUSIC_DIR, 'rock');
      fs.mkdirSync(subDir, { recursive: true });

      const res = await request(app)
        .get('/api/library-config/browse')
        .query({ path: TEST_MUSIC_DIR })
        .expect(200);

      expect(res.body.current).toBe(path.resolve(TEST_MUSIC_DIR));
      expect(Array.isArray(res.body.directories)).toBe(true);
      const names = res.body.directories.map(d => d.name);
      expect(names).toContain('rock');

      fs.rmdirSync(subDir);
    });

    test('excludes hidden directories (starting with .)', async () => {
      const hidden = path.join(TEST_MUSIC_DIR, '.hidden');
      fs.mkdirSync(hidden, { recursive: true });

      const res = await request(app)
        .get('/api/library-config/browse')
        .query({ path: TEST_MUSIC_DIR })
        .expect(200);

      const names = res.body.directories.map(d => d.name);
      expect(names).not.toContain('.hidden');

      fs.rmdirSync(hidden);
    });

    test('returns parent path when not at filesystem root', async () => {
      const res = await request(app)
        .get('/api/library-config/browse')
        .query({ path: TEST_MUSIC_DIR })
        .expect(200);

      expect(res.body.parent).toBe(path.dirname(path.resolve(TEST_MUSIC_DIR)));
    });

    test('returns 400 when path cannot be read', async () => {
      const res = await request(app)
        .get('/api/library-config/browse')
        .query({ path: '/nonexistent/path/xyz' })
        .expect(400);
      expect(res.body.error).toMatch(/Cannot read/);
    });

    test('each directory entry includes name and path', async () => {
      const sub = path.join(TEST_MUSIC_DIR, 'jazz');
      fs.mkdirSync(sub, { recursive: true });

      const res = await request(app)
        .get('/api/library-config/browse')
        .query({ path: TEST_MUSIC_DIR })
        .expect(200);

      const jazzEntry = res.body.directories.find(d => d.name === 'jazz');
      expect(jazzEntry).toBeDefined();
      expect(jazzEntry.path).toBe(path.join(path.resolve(TEST_MUSIC_DIR), 'jazz'));

      fs.rmdirSync(sub);
    });

    test('defaults to platform root when no path query param is given', async () => {
      // Just verify it returns a 200 with valid structure
      const res = await request(app)
        .get('/api/library-config/browse')
        .expect(200);
      expect(res.body.current).toBeDefined();
      expect(Array.isArray(res.body.directories)).toBe(true);
    });
  });
});
