'use strict';

/**
 * S5 — Env file injection fix verification.
 * Tests key validation and value sanitisation in updateEnvFile.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Each test group gets its own temp directory containing a `.env` file.
// We point INSTALL_DIR at that directory so getEnvFilePath() finds it.

let tempDir;
let tempEnvPath;

function loadModule() {
  jest.resetModules();
  process.env.INSTALL_DIR = tempDir;
  return require('../../src/services/container-manager');
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notify-test-'));
  tempEnvPath = path.join(tempDir, '.env');
  fs.writeFileSync(tempEnvPath, 'EXISTING_KEY=hello\n');
});

afterEach(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  delete process.env.INSTALL_DIR;
  jest.resetModules();
});

describe('container-manager — S5 env file key validation', () => {
  it('accepts valid alphanumeric+underscore keys', () => {
    const { updateEnvFile } = loadModule();
    const result = updateEnvFile({ VALID_KEY: 'somevalue' });
    expect(result).toBe(true);
    const written = fs.readFileSync(tempEnvPath, 'utf8');
    expect(written).toContain('VALID_KEY=somevalue');
  });

  it('rejects keys with spaces', () => {
    const { updateEnvFile } = loadModule();
    const result = updateEnvFile({ 'BAD KEY': 'val' });
    expect(result).toBe(false);
  });

  it('rejects keys with dots', () => {
    const { updateEnvFile } = loadModule();
    const result = updateEnvFile({ 'BAD.KEY': 'val' });
    expect(result).toBe(false);
  });

  it('rejects keys with hyphens', () => {
    const { updateEnvFile } = loadModule();
    const result = updateEnvFile({ 'BAD-KEY': 'val' });
    expect(result).toBe(false);
  });

  it('rejects keys with regex metacharacters', () => {
    const { updateEnvFile } = loadModule();
    const result = updateEnvFile({ 'KEY.*': 'val' });
    expect(result).toBe(false);
  });

  it('rejects keys starting with a digit', () => {
    const { updateEnvFile } = loadModule();
    const result = updateEnvFile({ '1BADKEY': 'val' });
    expect(result).toBe(false);
  });
});

describe('container-manager — S5 env file value sanitisation', () => {
  it('strips newlines from values (LF) — prevents new-line injection', () => {
    const { updateEnvFile } = loadModule();
    updateEnvFile({ INJECTED: "safe\nINJECTED_VAR=evil" });
    const written = fs.readFileSync(tempEnvPath, 'utf8');
    // After stripping \n, the value is on a single line — INJECTED_VAR must not
    // appear as a standalone key assignment (own line starting with INJECTED_VAR=).
    expect(written).not.toMatch(/^INJECTED_VAR=evil$/m);
    expect(written).toMatch(/^INJECTED=/m);
  });

  it('strips carriage-return+newline from values (CRLF) — prevents new-line injection', () => {
    const { updateEnvFile } = loadModule();
    updateEnvFile({ INJECTED: "safe\r\nINJECTED_VAR=evil" });
    const written = fs.readFileSync(tempEnvPath, 'utf8');
    expect(written).not.toMatch(/^INJECTED_VAR=evil$/m);
    expect(written).toMatch(/^INJECTED=/m);
  });

  it('strips bare CR from values — prevents terminal-overwrite injection', () => {
    const { updateEnvFile } = loadModule();
    updateEnvFile({ INJECTED: "safe\rINJECTED_VAR=evil" });
    const written = fs.readFileSync(tempEnvPath, 'utf8');
    // A bare \r stripped means INJECTED_VAR=evil is part of the same value
    // and must not appear as a standalone env assignment line.
    expect(written).not.toMatch(/^INJECTED_VAR=evil$/m);
    expect(written).toMatch(/^INJECTED=/m);
  });

  it('escapes dollar signs in values', () => {
    const { updateEnvFile } = loadModule();
    updateEnvFile({ DOLLAR_KEY: '$HOME/secret' });
    const written = fs.readFileSync(tempEnvPath, 'utf8');
    expect(written).toContain('DOLLAR_KEY=\\$HOME/secret');
  });

  it('updates an existing key in-place without duplicating it', () => {
    const { updateEnvFile } = loadModule();
    updateEnvFile({ EXISTING_KEY: 'updated' });
    const written = fs.readFileSync(tempEnvPath, 'utf8');
    const matches = (written.match(/^EXISTING_KEY=/gm) || []);
    expect(matches).toHaveLength(1);
    expect(written).toContain('EXISTING_KEY=updated');
  });
});
