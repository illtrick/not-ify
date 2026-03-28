'use strict';

// Suite A4 — Library logic: quality ranking, folder name cleaning, track IDs, scanMusicDir

const path = require('path');
const fs = require('fs');
const os = require('os');

const { _test } = require('../../src/api/library');
const { cleanFolderName, QUALITY_RANK, assignStableIds } = _test;
const { generateTrackId, extractTrackNumber, titleFromFilename } = require('../../src/services/track-id');

// ---------------------------------------------------------------------------
// QUALITY_RANK — format ordering for deduplication
// ---------------------------------------------------------------------------
describe('QUALITY_RANK ordering', () => {
  test('FLAC > WAV', () => expect(QUALITY_RANK.flac).toBeGreaterThan(QUALITY_RANK.wav));
  test('WAV > M4A',  () => expect(QUALITY_RANK.wav).toBeGreaterThan(QUALITY_RANK.m4a));
  test('M4A > AAC',  () => expect(QUALITY_RANK.m4a).toBeGreaterThan(QUALITY_RANK.aac));
  test('AAC == OPUS == OGG', () => {
    expect(QUALITY_RANK.aac).toBe(QUALITY_RANK.opus);
    expect(QUALITY_RANK.aac).toBe(QUALITY_RANK.ogg);
  });
  test('MP3 is lowest', () => {
    const allOthers = ['flac', 'wav', 'm4a', 'aac', 'opus', 'ogg'];
    allOthers.forEach(fmt => {
      expect(QUALITY_RANK[fmt]).toBeGreaterThan(QUALITY_RANK.mp3);
    });
  });
  test('dedup sort keeps FLAC over MP3', () => {
    const tracks = [
      { format: 'mp3', _fullPath: '/a/b/track.mp3' },
      { format: 'flac', _fullPath: '/a/b/track.flac' },
    ];
    tracks.sort((a, b) => (QUALITY_RANK[b.format] || 0) - (QUALITY_RANK[a.format] || 0));
    expect(tracks[0].format).toBe('flac');
  });
});

// ---------------------------------------------------------------------------
// cleanFolderName — strips torrent artifacts from folder-derived names
// ---------------------------------------------------------------------------
describe('cleanFolderName', () => {
  test('strips FLAC quality tag', () => {
    expect(cleanFolderName('Dark Side of the Moon FLAC')).not.toMatch(/FLAC/i);
  });
  test('strips 320 quality tag', () => {
    expect(cleanFolderName('OK Computer 320')).not.toMatch(/\b320\b/);
  });
  test('strips trailing dedup number', () => {
    expect(cleanFolderName('Abbey Road 88')).not.toMatch(/\s+88$/);
  });
  test('decodes &amp; entity', () => {
    expect(cleanFolderName('AC&amp;DC')).toBe('AC&DC');
  });
  test('decodes &ndash; entity', () => {
    expect(cleanFolderName('Artist &ndash; Album')).toContain('-');
  });
  test('strips leading/trailing dashes', () => {
    const r = cleanFolderName('- Album Name -');
    expect(r).not.toMatch(/^-/);
    expect(r).not.toMatch(/-$/);
  });
  test('normalises multiple spaces', () => {
    expect(cleanFolderName('Too  Many  Spaces')).not.toMatch(/\s{2,}/);
  });
  test('returns original if cleaned would be empty', () => {
    const result = cleanFolderName('FLAC');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
  test('leaves normal names unchanged', () => {
    expect(cleanFolderName('Pink Floyd')).toBe('Pink Floyd');
    expect(cleanFolderName('Radiohead')).toBe('Radiohead');
  });
});

// ---------------------------------------------------------------------------
// generateTrackId — stable content-based IDs
// ---------------------------------------------------------------------------
describe('generateTrackId', () => {
  test('returns 16-char hex string', () => {
    const id = generateTrackId('Artist', 'Album', 'Track');
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  test('same metadata → same id', () => {
    expect(generateTrackId('A', 'B', 'C')).toBe(generateTrackId('A', 'B', 'C'));
  });

  test('different titles → different ids', () => {
    expect(generateTrackId('A', 'B', 'Track1')).not.toBe(generateTrackId('A', 'B', 'Track2'));
  });

  test('case insensitive', () => {
    expect(generateTrackId('Artist', 'Album', 'Track')).toBe(generateTrackId('ARTIST', 'ALBUM', 'TRACK'));
  });

  test('same id regardless of file extension (survives MP3→FLAC upgrade)', () => {
    // ID is based on (artist|album|title), NOT filepath
    const id1 = generateTrackId('Pink Floyd', 'Animals', 'Pigs');
    const id2 = generateTrackId('Pink Floyd', 'Animals', 'Pigs');
    expect(id1).toBe(id2);
  });

  test('discriminator produces different ids for same title', () => {
    const id0 = generateTrackId('A', 'B', 'Track', 0);
    const id1 = generateTrackId('A', 'B', 'Track', 1);
    expect(id0).not.toBe(id1);
  });
});

// ---------------------------------------------------------------------------
// extractTrackNumber / titleFromFilename
// ---------------------------------------------------------------------------
describe('extractTrackNumber', () => {
  test('extracts "01-" prefix', () => expect(extractTrackNumber('01-Track.mp3')).toBe(1));
  test('extracts "01 " prefix', () => expect(extractTrackNumber('01 Track.mp3')).toBe(1));
  test('extracts "12_" prefix', () => expect(extractTrackNumber('12_Track.mp3')).toBe(12));
  test('returns null for no number', () => expect(extractTrackNumber('Track.mp3')).toBeNull());
});

describe('titleFromFilename', () => {
  test('strips extension', () => expect(titleFromFilename('Track.mp3')).toBe('Track'));
  test('strips track number prefix', () => expect(titleFromFilename('01-Pigs.mp3')).toBe('Pigs'));
  test('strips "01 " prefix', () => expect(titleFromFilename('01 Track Name.flac')).toBe('Track Name'));
});

// ---------------------------------------------------------------------------
// assignStableIds — handles duplicate titles
// ---------------------------------------------------------------------------
describe('assignStableIds', () => {
  test('assigns unique ids to tracks with different titles', () => {
    const tracks = [
      { artist: 'A', album: 'B', title: 'Track1', filename: 'Track1.mp3' },
      { artist: 'A', album: 'B', title: 'Track2', filename: 'Track2.mp3' },
    ];
    assignStableIds(tracks);
    expect(tracks[0].id).toMatch(/^[0-9a-f]{16}$/);
    expect(tracks[0].id).not.toBe(tracks[1].id);
  });

  test('assigns different ids to duplicate titles via discriminator', () => {
    const tracks = [
      { artist: 'A', album: 'B', title: 'Same', filename: '01-Same.mp3' },
      { artist: 'A', album: 'B', title: 'Same', filename: '02-Same.mp3' },
    ];
    assignStableIds(tracks);
    expect(tracks[0].id).not.toBe(tracks[1].id);
  });
});

// ---------------------------------------------------------------------------
// scanMusicDir — real filesystem integration (temp dir)
// ---------------------------------------------------------------------------
describe('scanMusicDir (real temp filesystem)', () => {
  const { scanMusicDir } = _test;
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notify-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createTrack(artist, album, filename, content = 'audio') {
    const dir = path.join(tmpDir, artist, album);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), content);
  }

  function createMetadata(artist, album, meta) {
    const dir = path.join(tmpDir, artist, album);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.metadata.json'), JSON.stringify(meta));
  }

  test('returns empty array for empty directory', () => {
    expect(scanMusicDir(tmpDir)).toEqual([]);
  });

  test('returns empty array for non-existent directory', () => {
    expect(scanMusicDir('/nonexistent/path/xyz')).toEqual([]);
  });

  test('scans a single track', () => {
    createTrack('Pink Floyd', 'Animals', '01-Pigs.mp3');
    const tracks = scanMusicDir(tmpDir);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].artist).toBe('Pink Floyd');
    expect(tracks[0].album).toBe('Animals');
    expect(tracks[0].format).toBe('mp3');
  });

  test('derives title by stripping track number prefix', () => {
    createTrack('Pink Floyd', 'Animals', '01 - Pigs Three Different Ones.mp3');
    const tracks = scanMusicDir(tmpDir);
    expect(tracks[0].title).not.toMatch(/^01/);
    expect(tracks[0].title).toContain('Pigs');
  });

  test('ignores non-audio files', () => {
    createTrack('Artist', 'Album', 'cover.jpg');
    createTrack('Artist', 'Album', 'info.nfo');
    expect(scanMusicDir(tmpDir)).toHaveLength(0);
  });

  test('scans multiple tracks across albums', () => {
    createTrack('Artist', 'Album1', 'track1.flac');
    createTrack('Artist', 'Album1', 'track2.flac');
    createTrack('Artist', 'Album2', 'track1.mp3');
    const tracks = scanMusicDir(tmpDir);
    expect(tracks).toHaveLength(3);
  });

  test('inherits .metadata.json fields onto all tracks', () => {
    createMetadata('Radiohead', 'OK Computer', {
      coverArt: 'https://cover.example.com/ok.jpg',
      mbid: 'test-mbid-123',
      year: '1997',
    });
    createTrack('Radiohead', 'OK Computer', 'track1.flac');
    createTrack('Radiohead', 'OK Computer', 'track2.flac');

    const tracks = scanMusicDir(tmpDir);
    expect(tracks).toHaveLength(2);
    tracks.forEach(t => {
      expect(t.coverArt).toBe('https://cover.example.com/ok.jpg');
      expect(t.mbid).toBe('test-mbid-123');
      expect(t.year).toBe('1997');
    });
  });

  test('null metadata fields when .metadata.json absent', () => {
    createTrack('Artist', 'Album', 'track.flac');
    const tracks = scanMusicDir(tmpDir);
    expect(tracks[0].coverArt).toBeNull();
    expect(tracks[0].mbid).toBeNull();
    expect(tracks[0].year).toBeNull();
  });

  test('extracts track number from filename', () => {
    createTrack('Artist', 'Album', '05-Track.mp3');
    const tracks = scanMusicDir(tmpDir);
    expect(tracks[0].trackNumber).toBe(5);
  });

  test('filepath is absolute path to file', () => {
    createTrack('Artist', 'Album', 'track.mp3');
    const tracks = scanMusicDir(tmpDir);
    expect(path.isAbsolute(tracks[0].filepath)).toBe(true);
    expect(tracks[0].filepath).toContain('track.mp3');
  });

  test('all audio formats detected', () => {
    const formats = ['mp3', 'flac', 'ogg', 'm4a', 'aac', 'wav', 'opus'];
    formats.forEach(ext => createTrack('Artist', 'Album', `track.${ext}`));
    const tracks = scanMusicDir(tmpDir);
    expect(tracks).toHaveLength(formats.length);
    const foundFormats = tracks.map(t => t.format).sort();
    expect(foundFormats).toEqual(formats.sort());
  });
});
