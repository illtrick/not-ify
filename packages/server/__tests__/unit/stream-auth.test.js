'use strict';

// Use a temp dir for CONFIG_DIR so stream.key doesn't affect other tests
const os = require('os');
const path = require('path');
const tmp = path.join(os.tmpdir(), 'stream-auth-test-' + process.pid);
process.env.CONFIG_DIR = tmp;

const streamAuth = require('../../src/services/stream-auth');

describe('stream-auth', () => {
  const BASE = 'http://192.168.1.100:3000';

  describe('generateSignedUrl', () => {
    it('returns a URL with sig and exp query params', () => {
      const url = streamAuth.generateSignedUrl('abc123', BASE);
      expect(url).toMatch(/^http:\/\/192\.168\.1\.100:3000\/api\/stream\/abc123\?sig=[0-9a-f]+&exp=\d+$/);
    });

    it('exp is in the future', () => {
      const url = streamAuth.generateSignedUrl('abc123', BASE, 3600);
      const exp = parseInt(new URL(url).searchParams.get('exp'), 10);
      expect(exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });
  });

  describe('generateSignedYtUrl', () => {
    it('returns a yt stream URL with sig and exp', () => {
      const url = streamAuth.generateSignedYtUrl('dQw4w9WgXcQ', BASE);
      expect(url).toMatch(/\/api\/yt\/stream\/dQw4w9WgXcQ\?sig=[0-9a-f]+&exp=\d+/);
    });
  });

  describe('verifySignature', () => {
    it('accepts a valid signature', () => {
      const url = streamAuth.generateSignedUrl('track1', BASE);
      const params = new URL(url).searchParams;
      expect(streamAuth.verifySignature('track1', params.get('sig'), params.get('exp'))).toBe(true);
    });

    it('rejects tampered id', () => {
      const url = streamAuth.generateSignedUrl('track1', BASE);
      const params = new URL(url).searchParams;
      expect(streamAuth.verifySignature('track2', params.get('sig'), params.get('exp'))).toBe(false);
    });

    it('rejects expired signature', () => {
      const exp = Math.floor(Date.now() / 1000) - 1;
      const url = streamAuth.generateSignedUrl('track1', BASE, -1);
      const params = new URL(url).searchParams;
      expect(streamAuth.verifySignature('track1', params.get('sig'), exp.toString())).toBe(false);
    });

    it('rejects missing sig', () => {
      expect(streamAuth.verifySignature('track1', null, '9999999999')).toBe(false);
    });

    it('rejects missing exp', () => {
      expect(streamAuth.verifySignature('track1', 'abc', null)).toBe(false);
    });

    // S10 — invalid hex must not throw
    it('returns false (not throws) for non-hex sig', () => {
      const exp = (Math.floor(Date.now() / 1000) + 3600).toString();
      expect(() => streamAuth.verifySignature('track1', 'not-valid-hex!', exp)).not.toThrow();
      expect(streamAuth.verifySignature('track1', 'not-valid-hex!', exp)).toBe(false);
    });

    it('returns false (not throws) for empty-string sig', () => {
      const exp = (Math.floor(Date.now() / 1000) + 3600).toString();
      expect(streamAuth.verifySignature('track1', '', exp)).toBe(false);
    });

    it('returns false for wrong-length valid-hex sig', () => {
      const exp = (Math.floor(Date.now() / 1000) + 3600).toString();
      // Valid hex but wrong length — timingSafeEqual would throw without the guard
      expect(streamAuth.verifySignature('track1', 'deadbeef', exp)).toBe(false);
    });
  });
});
