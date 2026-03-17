'use strict';

// Suite A1 + A2 — Torrent name parsing, cleaning, and junk detection
// Tests pure functions extracted from server/src/api/search.js and server/src/services/downloader.js

const { _test } = require('../../src/api/search');
const { parseTorrentName, cleanDisplayName, decodeEntities, isJunkTorrent } = _test;

const { parseArtistAlbum, sanitizePath, isAudioFile, isArchive } = require('../../src/services/downloader');

// ---------------------------------------------------------------------------
// parseTorrentName — extracts artist, album, quality, year from raw torrent name
// ---------------------------------------------------------------------------
describe('parseTorrentName', () => {
  test('standard "Artist - Album [FLAC]" format', () => {
    const r = parseTorrentName('Pink Floyd - Dark Side of the Moon [FLAC]');
    expect(r.artist).toBe('Pink Floyd');
    expect(r.album).toBe('Dark Side of the Moon');
    expect(r.quality).toBe('FLAC');
  });

  test('includes year in brackets', () => {
    const r = parseTorrentName('Radiohead - OK Computer (1997) [FLAC]');
    expect(r.artist).toBe('Radiohead');
    expect(r.album).toBe('OK Computer');
    expect(r.year).toBe('1997');
  });

  test('320kbps MP3', () => {
    const r = parseTorrentName('The Beatles - Abbey Road [320]');
    expect(r.artist).toBe('The Beatles');
    expect(r.quality).toBe('320');
  });

  test('V0 quality', () => {
    const r = parseTorrentName('Led Zeppelin - IV [V0]');
    expect(r.quality).toBe('V0');
  });

  test('em-dash separator', () => {
    const r = parseTorrentName('Björk \u2014 Homogenic [FLAC]');
    expect(r.artist).toBe('Björk');
    expect(r.album).toBe('Homogenic');
  });

  test('en-dash separator', () => {
    const r = parseTorrentName('Tool \u2013 Lateralus [FLAC]');
    expect(r.artist).toBe('Tool');
    expect(r.album).toBe('Lateralus');
  });

  test('album with multiple dashes preserved', () => {
    const r = parseTorrentName('Miles Davis - Kind of Blue - Remaster [FLAC]');
    expect(r.artist).toBe('Miles Davis');
    expect(r.album).toContain('Kind of Blue');
  });

  test('no artist found when name has no separator', () => {
    const r = parseTorrentName('SomeAlbumNoArtist.flac');
    expect(r.artist).toBe('');
    expect(typeof r.album).toBe('string');
  });

  test('quality detection is case insensitive', () => {
    const r = parseTorrentName('Artist - Album [flac]');
    expect(r.quality).toBe('FLAC');
  });
});

// ---------------------------------------------------------------------------
// cleanDisplayName — strips artifacts from torrent display names
// ---------------------------------------------------------------------------
describe('cleanDisplayName', () => {
  test('strips FLAC quality word', () => {
    const r = cleanDisplayName('Dark Side of the Moon FLAC');
    expect(r).not.toMatch(/FLAC/i);
  });

  test('strips 320 quality word', () => {
    expect(cleanDisplayName('OK Computer 320')).not.toMatch(/320/);
  });

  // Note: QOBUZ and uploader tags like eNJoY-iT are filtered at the torrent level
  // via isJunkTorrent / UPLOADER_RE (after a separator), not cleanDisplayName.
  // cleanDisplayName focuses on quality words, brackets with known metadata, and display cleaning.
  test('strips [PMEDIA] known uploader tag from bracket', () => {
    expect(cleanDisplayName('Abbey Road [PMEDIA]')).not.toMatch(/PMEDIA/i);
  });

  test('strips [rutracker] known uploader tag from bracket', () => {
    expect(cleanDisplayName('Album [rutracker]')).not.toMatch(/rutracker/i);
  });

  test('strips (Remaster) edition bracket', () => {
    expect(cleanDisplayName('Dark Side (Remaster Edition)')).not.toMatch(/Remaster/i);
  });

  test('strips trailing bare year', () => {
    const r = cleanDisplayName('Abbey Road - 1969');
    expect(r).not.toMatch(/1969/);
  });

  test('strips year range', () => {
    const r = cleanDisplayName('Discography 1984-2008');
    expect(r).not.toMatch(/1984/);
  });

  test('does NOT strip genre words embedded in artist name', () => {
    // "Daft Punk" contains no genre word standalone
    expect(cleanDisplayName('Daft Punk')).toContain('Daft Punk');
  });

  test('handles null / undefined gracefully', () => {
    expect(cleanDisplayName(null)).toBe('');
    expect(cleanDisplayName(undefined)).toBe('');
    expect(cleanDisplayName('')).toBe('');
  });

  test('strips @ uploader tag', () => {
    expect(cleanDisplayName('Album Name @ peaSoup')).not.toMatch(/@/);
  });

  test('strips emoji', () => {
    const r = cleanDisplayName('Album Name ✅🎵');
    expect(r).not.toMatch(/[^\x00-\x7F]/); // no non-ASCII emoji
  });

  test('normalises double spaces', () => {
    const r = cleanDisplayName('Some  Album  Name');
    expect(r).not.toMatch(/\s{2,}/);
  });

  test('strips 2CD / 4CD disc count tags', () => {
    expect(cleanDisplayName('Discography 4 CD')).not.toMatch(/\d+ ?CD/i);
  });
});

// ---------------------------------------------------------------------------
// decodeEntities — HTML entity decoding in torrent names
// ---------------------------------------------------------------------------
describe('decodeEntities', () => {
  test('decodes &amp;', () => expect(decodeEntities('AC&amp;DC')).toBe('AC&DC'));
  test('decodes &rsquo;', () => expect(decodeEntities("Don&rsquo;t")).toBe("Don't"));
  test('decodes &#39; (numeric)', () => expect(decodeEntities('Rock&#39;n&#39;Roll')).toBe("Rock'n'Roll"));
  test('decodes &ndash;', () => expect(decodeEntities('Artist &ndash; Album')).toBe('Artist - Album'));
  test('handles empty string', () => expect(decodeEntities('')).toBe(''));
  test('handles null', () => expect(decodeEntities(null)).toBe(''));
});

// ---------------------------------------------------------------------------
// isJunkTorrent — filters custom remasters, aggregators, bootlegs, compilations
// ---------------------------------------------------------------------------
describe('isJunkTorrent', () => {
  test('filters custom remaster', () => {
    expect(isJunkTorrent('Artist - Album (Custom Remaster)', 'Artist')).toBe(true);
  });

  test('filters "Remastered By" variant', () => {
    expect(isJunkTorrent('Album Remastered By SomeGuy', 'Artist')).toBe(true);
  });

  test('filters QOBUZ aggregator', () => {
    expect(isJunkTorrent('Artist - Album [QOBUZ]', 'Artist')).toBe(true);
  });

  test('filters Tidal aggregator', () => {
    expect(isJunkTorrent('Artist - Album Tidal', 'Artist')).toBe(true);
  });

  test('filters HDtracks aggregator', () => {
    expect(isJunkTorrent('Artist - Album [HDtracks]', 'Artist')).toBe(true);
  });

  test('filters bootleg', () => {
    expect(isJunkTorrent('Artist - Live Bootleg 1985', 'Artist')).toBe(true);
  });

  test('filters compilation when query is not for compilations', () => {
    expect(isJunkTorrent('Artist - Greatest Hits', 'Artist')).toBe(true);
  });

  test('does NOT filter greatest hits when query asks for it', () => {
    expect(isJunkTorrent('Artist - Greatest Hits', 'greatest hits')).toBe(false);
  });

  test('does NOT filter normal album', () => {
    expect(isJunkTorrent('Pink Floyd - Animals [FLAC]', 'Pink Floyd')).toBe(false);
  });

  test('filters "Best Of" compilation', () => {
    expect(isJunkTorrent('Artist - Best Of Collection', 'Artist')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseArtistAlbum — downloader.js simple artist/album split
// ---------------------------------------------------------------------------
describe('parseArtistAlbum (downloader)', () => {
  test('splits on dash', () => {
    const r = parseArtistAlbum('Pink Floyd - Animals');
    expect(r).toEqual({ artist: 'Pink Floyd', album: 'Animals' });
  });

  test('strips brackets', () => {
    const r = parseArtistAlbum('Pink Floyd - Animals [FLAC] (1977)');
    expect(r.artist).toBe('Pink Floyd');
    expect(r.album).toBe('Animals');
  });

  test('returns null when no separator', () => {
    expect(parseArtistAlbum('SomeAlbumNoSeparator')).toBeNull();
  });

  test('handles em-dash separator', () => {
    const r = parseArtistAlbum('Tool \u2014 Lateralus');
    expect(r.artist).toBe('Tool');
    expect(r.album).toBe('Lateralus');
  });

  test('returns null for empty string', () => {
    expect(parseArtistAlbum('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sanitizePath — removes filesystem-unsafe characters
// ---------------------------------------------------------------------------
describe('sanitizePath', () => {
  test('replaces forward slash', () => {
    expect(sanitizePath('AC/DC')).toBe('AC_DC');
  });

  test('replaces colon', () => {
    expect(sanitizePath('Artist: Title')).toBe('Artist_ Title');
  });

  test('replaces backslash', () => {
    expect(sanitizePath('Win\\Path')).toBe('Win_Path');
  });

  test('replaces double-quote', () => {
    expect(sanitizePath('"Quotes"')).toBe('_Quotes_');
  });

  test('collapses multiple spaces to single space', () => {
    expect(sanitizePath('Too   Many   Spaces')).toBe('Too Many Spaces');
  });

  test('trims leading/trailing spaces', () => {
    expect(sanitizePath('  Album  ')).toBe('Album');
  });

  test('leaves normal names unchanged', () => {
    expect(sanitizePath('OK Computer')).toBe('OK Computer');
  });
});

// ---------------------------------------------------------------------------
// isAudioFile / isArchive — file type detection
// ---------------------------------------------------------------------------
describe('isAudioFile', () => {
  test.each(['.mp3', '.flac', '.ogg', '.m4a', '.aac', '.wav', '.opus'])('detects %s as audio', ext => {
    expect(isAudioFile(`track01${ext}`)).toBe(true);
  });

  test.each(['.jpg', '.png', '.txt', '.pdf', '.nfo', '.cue'])('rejects %s as non-audio', ext => {
    expect(isAudioFile(`file${ext}`)).toBe(false);
  });

  test('case insensitive', () => {
    expect(isAudioFile('Track.FLAC')).toBe(true);
    expect(isAudioFile('Track.MP3')).toBe(true);
  });
});

describe('isArchive', () => {
  test('detects .rar', () => expect(isArchive('archive.rar')).toBe(true));
  test('detects .zip', () => expect(isArchive('archive.zip')).toBe(true));
  test('rejects .mp3', () => expect(isArchive('track.mp3')).toBe(false));
  test('case insensitive', () => expect(isArchive('ARCHIVE.RAR')).toBe(true));
});
