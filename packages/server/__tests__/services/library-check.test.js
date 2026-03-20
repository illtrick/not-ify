const os = require('os');
const path = require('path');
const fs = require('fs');

describe('library-check', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notify-music-'));
    process.env.MUSIC_DIR = tmpDir;
    jest.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.MUSIC_DIR;
  });

  test('albumExistsInLibrary returns true when album folder has audio files', () => {
    const { albumExistsInLibrary } = require('../../src/services/library-check');
    const albumDir = path.join(tmpDir, 'Heilung', 'Ofnir');
    fs.mkdirSync(albumDir, { recursive: true });
    fs.writeFileSync(path.join(albumDir, '01-track.flac'), 'fake');
    expect(albumExistsInLibrary('Heilung', 'Ofnir')).toBe(true);
  });

  test('albumExistsInLibrary returns false for empty album folder', () => {
    const { albumExistsInLibrary } = require('../../src/services/library-check');
    const albumDir = path.join(tmpDir, 'Heilung', 'Ofnir');
    fs.mkdirSync(albumDir, { recursive: true });
    expect(albumExistsInLibrary('Heilung', 'Ofnir')).toBe(false);
  });

  test('albumExistsInLibrary returns false when not in library', () => {
    const { albumExistsInLibrary } = require('../../src/services/library-check');
    expect(albumExistsInLibrary('Unknown', 'Album')).toBe(false);
  });

  test('normalize handles case and special characters', () => {
    const { normalize } = require('../../src/services/library-check');
    expect(normalize('Heilung')).toBe('heilung');
    expect(normalize('AC/DC')).toBe('acdc');
    expect(normalize("Guns N' Roses")).toBe('gunsnroses');
    expect(normalize('  The Beatles  ')).toBe('thebeatles');
  });

  test('albumExistsInLibrary matches case-insensitively', () => {
    const { albumExistsInLibrary } = require('../../src/services/library-check');
    const albumDir = path.join(tmpDir, 'heilung', 'ofnir');
    fs.mkdirSync(albumDir, { recursive: true });
    fs.writeFileSync(path.join(albumDir, 'track.mp3'), 'fake');
    expect(albumExistsInLibrary('Heilung', 'Ofnir')).toBe(true);
  });

  test('albumExistsInLibrary ignores non-audio files', () => {
    const { albumExistsInLibrary } = require('../../src/services/library-check');
    const albumDir = path.join(tmpDir, 'Heilung', 'Ofnir');
    fs.mkdirSync(albumDir, { recursive: true });
    fs.writeFileSync(path.join(albumDir, 'cover.jpg'), 'fake');
    fs.writeFileSync(path.join(albumDir, 'info.txt'), 'fake');
    expect(albumExistsInLibrary('Heilung', 'Ofnir')).toBe(false);
  });
});
