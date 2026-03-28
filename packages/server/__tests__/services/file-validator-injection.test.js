'use strict';

const fs = require('fs');
const path = require('path');

const validatorPath = path.join(__dirname, '../../src/services/file-validator.js');
const source = fs.readFileSync(validatorPath, 'utf8');

describe('file-validator.js command injection prevention', () => {
  it('does not contain execSync with template literal', () => {
    expect(source).not.toMatch(/execSync\s*\(\s*`/);
  });

  it('uses execFileSync for the file command', () => {
    expect(source).toMatch(/execFileSync\s*\(\s*'file'/);
  });

  it('uses execFileSync for the ffprobe command', () => {
    expect(source).toMatch(/execFileSync\s*\(\s*'ffprobe'/);
  });

  it('passes filePath as an array argument, not in a template string', () => {
    // Both calls should use array form with filePath
    const execFileCalls = source.match(/execFileSync\s*\([^)]+\)/gs) || [];
    expect(execFileCalls.length).toBeGreaterThanOrEqual(2);
    for (const call of execFileCalls) {
      expect(call).not.toMatch(/`/); // no template literals
    }
  });
});
