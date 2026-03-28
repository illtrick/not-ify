'use strict';

// Suite — POST /api/setup/account race-condition guard (S9)

const os = require('os');
const path = require('path');

// Isolated temp DB so this suite doesn't collide with setup.test.js
process.env.CONFIG_DIR = path.join(os.tmpdir(), `notify-test-setup-race-${process.pid}`);

const express = require('express');
const request = require('supertest');
const db = require('../../src/services/db');
const setupMiddleware = require('../../src/middleware/setup');
const setupRouter = require('../../src/api/setup');

const app = express();
app.use(express.json());
app.use('/api/setup', setupRouter);

afterEach(() => {
  try {
    const conn = db.getDb();
    conn.prepare('DELETE FROM users').run();
    conn.prepare('DELETE FROM global_settings').run();
  } catch {
    // ignore
  }
  setupMiddleware._resetCache();
});

afterAll(() => {
  db.close();
});

describe('POST /api/setup/account — race condition guard', () => {
  test('returns 409 when an account already exists', async () => {
    // Pre-create a user to simulate the "first request already won" state
    db.createUser('existing-user', 'Existing User', 'admin');

    const res = await request(app)
      .post('/api/setup/account')
      .send({ displayName: 'Second User' })
      .expect(409);

    expect(res.body.error).toMatch(/already exists/i);
  });

  test('first request creates the account successfully', async () => {
    const res = await request(app)
      .post('/api/setup/account')
      .send({ displayName: 'First User' })
      .expect(201);

    expect(res.body.userId).toBe('first-user');
    expect(res.body.isAdmin).toBe(true);
  });

  test('concurrent duplicate inserts: constraint error surfaces as 409', async () => {
    // Simulate the race by directly inserting the user with the same id that
    // the handler would generate, then immediately calling the endpoint.
    // This exercises the try-catch around db.createUser in the handler.
    db.createUser('race-user', 'Race User', 'admin');

    // Now reset getUserCount so the pre-check passes (simulate the other
    // request having not committed yet at check time).  We do this by
    // bypassing the count check: directly invoke createUser from the route
    // which will hit the UNIQUE constraint on the primary key.
    //
    // We can't truly replicate simultaneous I/O in a synchronous SQLite env,
    // but we can verify the catch path by injecting a second identical userId.
    // The endpoint derives userId from displayName — use the same displayName
    // so the generated userId collides.
    //
    // To force the count-check to pass we briefly mock getUserCount.
    const realGetUserCount = db.getUserCount.bind(db);
    let callCount = 0;
    db.getUserCount = () => {
      // Return 0 on first call (the pre-check inside the handler), then restore
      if (callCount++ === 0) return 0;
      return realGetUserCount();
    };

    try {
      const res = await request(app)
        .post('/api/setup/account')
        .send({ displayName: 'Race User' }) // same displayName → same userId → PK collision
        .expect(409);

      expect(res.body.error).toMatch(/already exists/i);
    } finally {
      db.getUserCount = realGetUserCount;
    }
  });
});
