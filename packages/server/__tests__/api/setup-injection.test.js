'use strict';

const fs = require('fs');
const path = require('path');

const setupPath = path.join(__dirname, '../../src/api/setup.js');
const source = fs.readFileSync(setupPath, 'utf8');

describe('setup.js command injection prevention', () => {
  it('does not contain execSync with df template literal', () => {
    // Should not have execSync(`df ...) pattern
    expect(source).not.toMatch(/execSync\s*\(\s*`\s*df\b/);
  });

  it('uses execFileSync for the df command', () => {
    expect(source).toMatch(/execFileSync\s*\(\s*'df'/);
  });

  it('does not use shell interpolation for musicDir in df call', () => {
    // Should not have "${musicDir}" inside a template literal with df
    expect(source).not.toMatch(/execSync\s*\(\s*`[^`]*\$\{musicDir\}[^`]*`/);
  });
});
