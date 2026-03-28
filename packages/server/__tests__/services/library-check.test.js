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

  // ─── albumTrackCount ──────────────────────────────────────────────────

  test('albumTrackCount returns count of audio files', () => {
    const { albumTrackCount } = require('../../src/services/library-check');
    const albumDir = path.join(tmpDir, 'Heilung', 'Ofnir');
    fs.mkdirSync(albumDir, { recursive: true });
    fs.writeFileSync(path.join(albumDir, '01-track.flac'), 'fake');
    fs.writeFileSync(path.join(albumDir, '02-track.mp3'), 'fake');
    fs.writeFileSync(path.join(albumDir, '03-track.ogg'), 'fake');
    fs.writeFileSync(path.join(albumDir, 'cover.jpg'), 'fake');
    expect(albumTrackCount('Heilung', 'Ofnir')).toBe(3);
  });

  test('albumTrackCount returns 0 when album not found', () => {
    const { albumTrackCount } = require('../../src/services/library-check');
    expect(albumTrackCount('Nonexistent', 'Album')).toBe(0);
  });

  test('albumTrackCount returns 0 for empty album dir', () => {
    const { albumTrackCount } = require('../../src/services/library-check');
    const albumDir = path.join(tmpDir, 'Heilung', 'Ofnir');
    fs.mkdirSync(albumDir, { recursive: true });
    expect(albumTrackCount('Heilung', 'Ofnir')).toBe(0);
  });

  test('albumTrackCount matches case-insensitively', () => {
    const { albumTrackCount } = require('../../src/services/library-check');
    const albumDir = path.join(tmpDir, 'heilung', 'ofnir');
    fs.mkdirSync(albumDir, { recursive: true });
    fs.writeFileSync(path.join(albumDir, 'track.flac'), 'fake');
    fs.writeFileSync(path.join(albumDir, 'track2.flac'), 'fake');
    expect(albumTrackCount('Heilung', 'Ofnir')).toBe(2);
  });

  // ─── excludedTrackCount ───────────────────────────────────────────────

  test('excludedTrackCount returns excluded array length from .metadata.json', () => {
    const { excludedTrackCount } = require('../../src/services/library-check');
    const albumDir = path.join(tmpDir, 'Heilung', 'Ofnir');
    fs.mkdirSync(albumDir, { recursive: true });
    fs.writeFileSync(path.join(albumDir, '.metadata.json'), JSON.stringify({
      excluded: ['03-bonus.flac', '04-intro.flac'],
    }));
    expect(excludedTrackCount('Heilung', 'Ofnir')).toBe(2);
  });

  test('excludedTrackCount returns 0 when no .metadata.json', () => {
    const { excludedTrackCount } = require('../../src/services/library-check');
    const albumDir = path.join(tmpDir, 'Heilung', 'Ofnir');
    fs.mkdirSync(albumDir, { recursive: true });
    expect(excludedTrackCount('Heilung', 'Ofnir')).toBe(0);
  });

  test('excludedTrackCount returns 0 when no excluded array in metadata', () => {
    const { excludedTrackCount } = require('../../src/services/library-check');
    const albumDir = path.join(tmpDir, 'Heilung', 'Ofnir');
    fs.mkdirSync(albumDir, { recursive: true });
    fs.writeFileSync(path.join(albumDir, '.metadata.json'), JSON.stringify({ mbid: 'abc' }));
    expect(excludedTrackCount('Heilung', 'Ofnir')).toBe(0);
  });

  test('excludedTrackCount returns 0 when album not found', () => {
    const { excludedTrackCount } = require('../../src/services/library-check');
    expect(excludedTrackCount('Nonexistent', 'Album')).toBe(0);
  });

  test('excludedTrackCount matches case-insensitively', () => {
    const { excludedTrackCount } = require('../../src/services/library-check');
    const albumDir = path.join(tmpDir, 'heilung', 'ofnir');
    fs.mkdirSync(albumDir, { recursive: true });
    fs.writeFileSync(path.join(albumDir, '.metadata.json'), JSON.stringify({
      excluded: ['removed-track.mp3'],
    }));
    expect(excludedTrackCount('Heilung', 'Ofnir')).toBe(1);
  });

  // ─── resolveAlbumDir ─────────────────────────────────────────────────

  describe('resolveAlbumDir', () => {
    test('returns existing dir when rgid matches DB album', () => {
      jest.doMock('../../src/services/db', () => ({
        getAlbumByRgid: jest.fn((rgid) =>
          rgid === 'rgid123' ? { album_artist: 'Tool', title: 'Fear Inoculum' } : undefined
        ),
        findAlbumByNormalizedName: jest.fn(() => null),
      }));
      const { resolveAlbumDir } = require('../../src/services/library-check');
      const existingDir = path.join(tmpDir, 'Tool', 'Fear Inoculum');
      fs.mkdirSync(existingDir, { recursive: true });
      const result = resolveAlbumDir('rgid123', 'Tool', 'Fear Inoculum (Deluxe)');
      expect(result).toBe(existingDir);
    });

    test('returns existing dir on normalized name match', () => {
      jest.doMock('../../src/services/db', () => ({
        getAlbumByRgid: jest.fn(() => undefined),
        findAlbumByNormalizedName: jest.fn(() => ({ artist: 'Tool', album: 'Fear Inoculum' })),
      }));
      const { resolveAlbumDir } = require('../../src/services/library-check');
      const existingDir = path.join(tmpDir, 'Tool', 'Fear Inoculum');
      fs.mkdirSync(existingDir, { recursive: true });
      const result = resolveAlbumDir(null, 'TOOL', 'fear inoculum');
      expect(result).toBe(existingDir);
    });

    test('returns new sanitized path when no match', () => {
      jest.doMock('../../src/services/db', () => ({
        getAlbumByRgid: jest.fn(() => undefined),
        findAlbumByNormalizedName: jest.fn(() => null),
      }));
      const { resolveAlbumDir } = require('../../src/services/library-check');
      const result = resolveAlbumDir(null, 'New Artist', 'New Album');
      expect(result).toBe(path.join(tmpDir, 'New Artist', 'New Album'));
    });
  });
});
