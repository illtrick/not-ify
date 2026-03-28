'use strict';

describe('quality comparison', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  function getModule() {
    return require('../../src/services/library-check');
  }

  test('QUALITY_RANK orders correctly', () => {
    const { QUALITY_RANK } = getModule();
    const rank = q => QUALITY_RANK[q] ?? 0;
    expect(rank('flac')).toBeGreaterThan(rank('320'));
    expect(rank('320')).toBeGreaterThan(rank('v0'));
    expect(rank('v0')).toBeGreaterThan(rank('256'));
    expect(rank('256')).toBeGreaterThan(rank('192'));
    expect(rank('192')).toBeGreaterThan(rank('128'));
    expect(rank('128')).toBeGreaterThan(rank('unknown'));
    expect(rank('unknown')).toBe(0);
  });

  test('isUpgrade returns true for mp3 -> flac', () => {
    const { isUpgrade } = getModule();
    expect(isUpgrade('unknown', 'flac')).toBe(true);
  });

  test('isUpgrade returns false for flac -> mp3', () => {
    const { isUpgrade } = getModule();
    expect(isUpgrade('flac', 'unknown')).toBe(false);
  });

  test('isUpgrade returns false for same quality', () => {
    const { isUpgrade } = getModule();
    expect(isUpgrade('320', '320')).toBe(false);
  });

  test('unknown existing + known incoming = upgrade', () => {
    const { isUpgrade } = getModule();
    expect(isUpgrade('unknown', 'flac')).toBe(true);
    expect(isUpgrade('unknown', '128')).toBe(true);
  });

  test('unknown to unknown is not an upgrade', () => {
    const { isUpgrade } = getModule();
    expect(isUpgrade('unknown', 'unknown')).toBe(false);
  });

  test('isUpgrade returns true for 128 -> 320', () => {
    const { isUpgrade } = getModule();
    expect(isUpgrade('128', '320')).toBe(true);
  });

  test('v0 ranks above 256', () => {
    const { isUpgrade } = getModule();
    expect(isUpgrade('256', 'v0')).toBe(true);
    expect(isUpgrade('v0', '256')).toBe(false);
  });
});
