'use strict';

const db = require('../../src/services/db');
const setupMiddleware = require('../../src/middleware/setup');

function mockReqRes(path) {
  const req = { path, originalUrl: path };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const next = jest.fn();
  return { req, res, next };
}

describe('setup middleware', () => {
  beforeEach(() => {
    const d = db.getDb();
    d.pragma('foreign_keys = OFF');
    d.prepare("DELETE FROM users").run();
    d.pragma('foreign_keys = ON');
    d.prepare("DELETE FROM global_settings WHERE key = 'setup_complete'").run();
    setupMiddleware._resetCache();
  });

  test('blocks non-setup API routes when no users exist', () => {
    const { req, res, next } = mockReqRes('/api/library');
    setupMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'setup_required' }));
  });

  test('allows /api/health through', () => {
    const { req, res, next } = mockReqRes('/api/health');
    setupMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('allows /api/setup/* through', () => {
    const { req, res, next } = mockReqRes('/api/setup/account');
    setupMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('allows all routes when users exist', () => {
    db.createUser('admin1', 'Admin', 'admin');
    setupMiddleware._resetCache();
    const { req, res, next } = mockReqRes('/api/library');
    setupMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('allows all routes when setup_complete flag is set', () => {
    db.setGlobalSetting('setup_complete', true);
    setupMiddleware._resetCache();
    const { req, res, next } = mockReqRes('/api/library');
    setupMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('allows static assets (non-api paths) through', () => {
    const { req, res, next } = mockReqRes('/index.html');
    setupMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('_markComplete bypasses DB check', () => {
    setupMiddleware._markComplete();
    const { req, res, next } = mockReqRes('/api/library');
    setupMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
