'use strict';

// jest.mock factory cannot reference outer-scope variables unless prefixed with 'mock'
let mockSetupComplete = false;
jest.mock('../../src/services/db', () => ({
  isSetupComplete: jest.fn(() => mockSetupComplete),
}));

const setupMiddleware = require('../../src/middleware/setup');

function mockReqRes(path) {
  return {
    req: { path, originalUrl: path },
    res: { status: jest.fn().mockReturnThis(), json: jest.fn() },
    next: jest.fn(),
  };
}

beforeEach(() => {
  setupMiddleware._resetCache();
  mockSetupComplete = false;
});

test('blocks API routes when setup incomplete', () => {
  const { req, res, next } = mockReqRes('/api/library');
  setupMiddleware(req, res, next);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(next).not.toHaveBeenCalled();
});

test('allows API routes after _markComplete is called', () => {
  const r1 = mockReqRes('/api/library');
  setupMiddleware(r1.req, r1.res, r1.next);
  expect(r1.res.status).toHaveBeenCalledWith(403);

  setupMiddleware._markComplete();

  const r2 = mockReqRes('/api/library');
  setupMiddleware(r2.req, r2.res, r2.next);
  expect(r2.next).toHaveBeenCalled();
});

test('always allows /api/setup and /api/health', () => {
  const health = mockReqRes('/api/health');
  setupMiddleware(health.req, health.res, health.next);
  expect(health.next).toHaveBeenCalled();

  const setup = mockReqRes('/api/setup/account');
  setupMiddleware(setup.req, setup.res, setup.next);
  expect(setup.next).toHaveBeenCalled();
});
