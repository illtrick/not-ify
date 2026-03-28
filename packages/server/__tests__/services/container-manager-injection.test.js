'use strict';

/**
 * S4 — Heredoc injection fix verification.
 * Confirms that writeSlskdApiKeyConfig no longer uses a heredoc pattern
 * and instead uses the safe positional parameter approach.
 */

const fs = require('fs');
const path = require('path');

const SOURCE_PATH = path.resolve(
  __dirname,
  '../../src/services/container-manager.js'
);

describe('container-manager — S4 heredoc injection fix', () => {
  let source;

  beforeAll(() => {
    source = fs.readFileSync(SOURCE_PATH, 'utf8');
  });

  it('does not contain a heredoc delimiter pattern', () => {
    expect(source).not.toMatch(/<< 'CFGEOF'/);
    expect(source).not.toMatch(/<<CFGEOF/);
    expect(source).not.toMatch(/<< "CFGEOF"/);
  });

  it('uses the safe positional parameter pattern', () => {
    // The safe form passes configYml as $1 to avoid shell interpolation
    expect(source).toMatch(/printf "%s" "\$1"/);
    expect(source).toMatch(/'_',\s*configYml/);
  });

  it('configYml is passed as a Cmd array element, not interpolated into a shell string', () => {
    // The Cmd value must be an array literal — look for the array form
    expect(source).toMatch(/Cmd:\s*\[/);
    // Confirm the old sh -c string-interpolation form is gone
    expect(source).not.toMatch(/Cmd:\s*\['sh',\s*'-c',\s*`[^`]*\$\{configYml\}/);
  });
});
