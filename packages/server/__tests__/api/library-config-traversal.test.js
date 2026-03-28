'use strict';

const { validateBrowsePath } = require('../../src/api/library-config')._test;

describe('library-config validateBrowsePath', () => {
  it('rejects paths containing null bytes', () => {
    const result = validateBrowsePath('/app/music\0/etc/passwd');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/null bytes/i);
  });

  it('rejects /etc', () => {
    const result = validateBrowsePath('/etc');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/restricted/i);
  });

  it('rejects /etc/passwd (subdirectory of /etc)', () => {
    const result = validateBrowsePath('/etc/passwd');
    expect(result.ok).toBe(false);
  });

  it('rejects /proc', () => {
    const result = validateBrowsePath('/proc');
    expect(result.ok).toBe(false);
  });

  it('rejects /sys', () => {
    const result = validateBrowsePath('/sys');
    expect(result.ok).toBe(false);
  });

  it('rejects /dev', () => {
    const result = validateBrowsePath('/dev');
    expect(result.ok).toBe(false);
  });

  it('allows /app/music', () => {
    const result = validateBrowsePath('/app/music');
    expect(result.ok).toBe(true);
  });

  it('allows /', () => {
    const result = validateBrowsePath('/');
    expect(result.ok).toBe(true);
  });

  it('rejects non-string input', () => {
    const result = validateBrowsePath(123);
    expect(result.ok).toBe(false);
  });
});
