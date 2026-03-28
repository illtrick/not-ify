'use strict';

// Suite A2 + A3 — Scoring, fuzzy matching, normalization, edit distance

const { _test } = require('../../src/api/search');
const { scoreSource, normalize, editDistance, matchToRelease, artistRelevant, rawGroupKey } = _test;

// ---------------------------------------------------------------------------
// scoreSource — quality + seeders + size penalty
// ---------------------------------------------------------------------------
describe('scoreSource', () => {
  const base = { seeders: 0, size: 500 * 1024 * 1024 }; // 500 MB — no size penalty

  test('FLAC scores higher than 320', () => {
    const flac = scoreSource({ ...base, quality: 'FLAC' });
    const mp3  = scoreSource({ ...base, quality: '320' });
    expect(flac).toBeGreaterThan(mp3);
  });

  test('320 scores higher than V0', () => {
    const a = scoreSource({ ...base, quality: '320' });
    const b = scoreSource({ ...base, quality: 'V0' });
    expect(a).toBeGreaterThan(b);
  });

  test('V0 scores higher than plain MP3', () => {
    const a = scoreSource({ ...base, quality: 'V0' });
    const b = scoreSource({ ...base, quality: 'MP3' });
    expect(a).toBeGreaterThan(b);
  });

  test('more seeders increases score', () => {
    const low  = scoreSource({ ...base, quality: 'FLAC', seeders: 1 });
    const high = scoreSource({ ...base, quality: 'FLAC', seeders: 100 });
    expect(high).toBeGreaterThan(low);
  });

  test('very large file (>2 GB) gets penalised', () => {
    const normal = scoreSource({ ...base, quality: 'FLAC', size: 600 * 1024 * 1024 });
    const huge   = scoreSource({ ...base, quality: 'FLAC', size: 3 * 1024 * 1024 * 1024 });
    expect(normal).toBeGreaterThan(huge);
  });

  test('very small file (<30 MB) gets penalised', () => {
    const normal = scoreSource({ ...base, quality: 'FLAC' });
    const tiny   = scoreSource({ quality: 'FLAC', seeders: 0, size: 5 * 1024 * 1024 });
    expect(normal).toBeGreaterThan(tiny);
  });

  test('LOSSLESS keyword treated same as FLAC', () => {
    const flac     = scoreSource({ ...base, quality: 'FLAC' });
    const lossless = scoreSource({ ...base, quality: 'LOSSLESS' });
    expect(flac).toBe(lossless);
  });

  test('24-BIT keyword treated as lossless', () => {
    const hires = scoreSource({ ...base, quality: '24-BIT' });
    const mp3   = scoreSource({ ...base, quality: 'MP3' });
    expect(hires).toBeGreaterThan(mp3);
  });

  test('zero seeders still works', () => {
    expect(() => scoreSource({ quality: 'FLAC', seeders: 0, size: 400 * 1024 * 1024 })).not.toThrow();
  });

  test('missing quality string still works', () => {
    expect(() => scoreSource({ seeders: 5, size: 400 * 1024 * 1024 })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// normalize — unicode-folded lowercase alphanumeric
// ---------------------------------------------------------------------------
describe('normalize', () => {
  test('lowercases', () => expect(normalize('FLAC')).toBe('flac'));
  test('strips accents', () => expect(normalize('Björk')).toBe('bjork'));
  test('strips spaces and punctuation', () => expect(normalize('Pink Floyd')).toBe('pinkfloyd'));
  test('strips apostrophes', () => expect(normalize("Can't Stop")).toBe('cantstop'));
  test('handles The prefix', () => expect(normalize('The Beatles')).toBe('thebeatles'));
  test('handles empty string', () => expect(normalize('')).toBe(''));
  test('handles null', () => expect(normalize(null)).toBe(''));
  test('strips accented e', () => expect(normalize('Café')).toBe('cafe'));
  test('normalises hyphen out', () => expect(normalize('AC-DC')).toBe('acdc'));
});

// ---------------------------------------------------------------------------
// editDistance — Levenshtein for typo matching
// ---------------------------------------------------------------------------
describe('editDistance', () => {
  test('identical strings → 0', () => expect(editDistance('tool', 'tool')).toBe(0));
  test('one char difference', () => expect(editDistance('flac', 'flag')).toBe(1));
  test('common typo Megadeth/Megadeath', () => expect(editDistance('megadeth', 'megadeath')).toBe(1));
  test('two char difference', () => expect(editDistance('radiohead', 'radiohaed')).toBe(2));
  test('returns 99 for very different lengths', () => {
    expect(editDistance('a', 'verylongstring')).toBe(99);
  });
  test('empty strings → 0', () => expect(editDistance('', '')).toBe(0));
  test('one empty → length of other', () => expect(editDistance('', 'abc')).toBe(3));
});

// ---------------------------------------------------------------------------
// matchToRelease — links torrent parsed data to MusicBrainz releases
// ---------------------------------------------------------------------------
describe('matchToRelease', () => {
  const mbReleases = [
    { mbid: 'mb1', rgid: 'rg1', artist: 'Pink Floyd', album: 'Dark Side of the Moon', year: '1973' },
    { mbid: 'mb2', rgid: 'rg2', artist: 'Radiohead', album: 'OK Computer', year: '1997' },
    { mbid: 'mb3', rgid: 'rg3', artist: 'Tool', album: 'Lateralus', year: '2001' },
  ];

  test('exact artist and album match', () => {
    const r = matchToRelease('Pink Floyd', 'Dark Side of the Moon', mbReleases);
    expect(r).not.toBeNull();
    expect(r.mbid).toBe('mb1');
  });

  test('case-insensitive match', () => {
    const r = matchToRelease('pink floyd', 'dark side of the moon', mbReleases);
    expect(r).not.toBeNull();
    expect(r.mbid).toBe('mb1');
  });

  test('accent normalization (Björk → bjork)', () => {
    const releases = [{ mbid: 'mb4', rgid: 'rg4', artist: 'Björk', album: 'Homogenic', year: '1997' }];
    const r = matchToRelease('Bjork', 'Homogenic', releases);
    expect(r).not.toBeNull();
  });

  test('artist typo within edit distance 2', () => {
    const r = matchToRelease('Radioheed', 'OK Computer', mbReleases);
    expect(r).not.toBeNull();
    expect(r.mbid).toBe('mb2');
  });

  test('no match for wrong artist', () => {
    const r = matchToRelease('Slayer', 'Dark Side of the Moon', mbReleases);
    expect(r).toBeNull();
  });

  test('no match for wrong album', () => {
    const r = matchToRelease('Pink Floyd', 'Animals', mbReleases);
    expect(r).toBeNull();
  });

  test('partial album containment matches', () => {
    // "Dark Side" is contained in "Dark Side of the Moon"
    const r = matchToRelease('Pink Floyd', 'Dark Side', mbReleases);
    expect(r).not.toBeNull();
  });

  test('returns null for empty inputs', () => {
    expect(matchToRelease('', '', mbReleases)).toBeNull();
    expect(matchToRelease('Artist', '', mbReleases)).toBeNull();
  });

  test('returns null for empty releases array', () => {
    expect(matchToRelease('Pink Floyd', 'Dark Side of the Moon', [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// artistRelevant — filters torrents from wrong artists
// ---------------------------------------------------------------------------
describe('artistRelevant', () => {
  test('exact match passes', () => {
    expect(artistRelevant('tool', 'Tool', 'tool')).toBe(true);
  });

  test('typo within edit distance 2 passes', () => {
    expect(artistRelevant('toool', 'Tool', 'tool')).toBe(true);
  });

  test('empty torrent artist passes (no parsed artist)', () => {
    expect(artistRelevant('', 'Tool', 'tool')).toBe(true);
    expect(artistRelevant(null, 'Tool', 'tool')).toBe(true);
  });

  test('the-prefix difference passes (The Tool vs Tool)', () => {
    expect(artistRelevant('thetool', 'Tool', 'tool')).toBe(true);
  });

  test('completely different artist is rejected', () => {
    expect(artistRelevant('DemonTool', 'Tool', 'tool')).toBe(false);
  });

  test('partial containment alone is NOT sufficient (Demon Tool vs Tool)', () => {
    // "demontool" contains "tool" but artistRelevant should reject it
    expect(artistRelevant('demontool', 'tool', 'tool')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rawGroupKey — stable dedup key for unmatched torrents
// ---------------------------------------------------------------------------
describe('rawGroupKey', () => {
  test('returns raw: prefix', () => {
    expect(rawGroupKey('Pink Floyd', 'Animals')).toMatch(/^raw:/);
  });

  test('strips quality words', () => {
    const a = rawGroupKey('Pink Floyd', 'Animals FLAC');
    const b = rawGroupKey('Pink Floyd', 'Animals MP3');
    expect(a).toBe(b);
  });

  test('strips year', () => {
    const a = rawGroupKey('Pink Floyd', 'Animals 1977');
    const b = rawGroupKey('Pink Floyd', 'Animals');
    expect(a).toBe(b);
  });

  test('strips remaster/deluxe edition variants', () => {
    const a = rawGroupKey('Pink Floyd', 'Animals Remastered');
    const b = rawGroupKey('Pink Floyd', 'Animals Deluxe Edition');
    expect(a).toBe(b);
  });

  test('different albums produce different keys', () => {
    const a = rawGroupKey('Pink Floyd', 'Animals');
    const b = rawGroupKey('Pink Floyd', 'The Wall');
    expect(a).not.toBe(b);
  });

  test('different artists produce different keys', () => {
    const a = rawGroupKey('Pink Floyd', 'Animals');
    const b = rawGroupKey('Tool', 'Animals');
    expect(a).not.toBe(b);
  });
});
