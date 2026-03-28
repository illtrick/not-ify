'use strict';

const rateLimit = require('../../src/middleware/rate-limit');

function mockReq(userId) {
  return { userId, ip: '127.0.0.1' };
}

function mockRes() {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  return res;
}

test('allows requests under the limit', () => {
  const mw = rateLimit({ windowMs: 1000, max: 3 });
  for (let i = 0; i < 3; i++) {
    const next = jest.fn();
    mw(mockReq('user1'), mockRes(), next);
    expect(next).toHaveBeenCalled();
  }
});

test('blocks requests over the limit', () => {
  const mw = rateLimit({ windowMs: 1000, max: 3 });
  for (let i = 0; i < 3; i++) {
    mw(mockReq('user1'), mockRes(), jest.fn());
  }
  const res = mockRes();
  const next = jest.fn();
  mw(mockReq('user1'), res, next);
  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(429);
});

test('different users have independent limits', () => {
  const mw = rateLimit({ windowMs: 1000, max: 1 });
  const next1 = jest.fn();
  const next2 = jest.fn();
  mw(mockReq('user1'), mockRes(), next1);
  mw(mockReq('user2'), mockRes(), next2);
  expect(next1).toHaveBeenCalled();
  expect(next2).toHaveBeenCalled();
});

test('window expires and allows new requests', async () => {
  const mw = rateLimit({ windowMs: 50, max: 1 });
  mw(mockReq('user1'), mockRes(), jest.fn());

  // Over limit
  const res = mockRes();
  mw(mockReq('user1'), res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(429);

  // Wait for window to expire
  await new Promise(r => setTimeout(r, 60));

  const next = jest.fn();
  mw(mockReq('user1'), mockRes(), next);
  expect(next).toHaveBeenCalled();
});
