'use strict';

const { selectAlbumFiles } = require('../../src/services/downloader');

describe('selectAlbumFiles', () => {
  test('single album torrent selects all audio files', () => {
    const rdFiles = [
      { id: 1, path: 'Artist - Album/01 - Track.flac', bytes: 30000000 },
      { id: 2, path: 'Artist - Album/02 - Track.flac', bytes: 30000000 },
      { id: 3, path: 'Artist - Album/cover.jpg', bytes: 500000 },
    ];
    const result = selectAlbumFiles(rdFiles, 'Artist', 'Album');
    expect(result.fileIds).toEqual([1, 2]);
    expect(result.isDiscography).toBe(false);
  });

  test('discography torrent selects only matching album folder', () => {
    const rdFiles = [
      { id: 1, path: 'Artist Discography/2000 - First Album/01.flac', bytes: 30000000 },
      { id: 2, path: 'Artist Discography/2000 - First Album/02.flac', bytes: 30000000 },
      { id: 3, path: 'Artist Discography/2004 - Target Album/01.flac', bytes: 30000000 },
      { id: 4, path: 'Artist Discography/2004 - Target Album/02.flac', bytes: 30000000 },
      { id: 5, path: 'Artist Discography/2008 - Third Album/01.flac', bytes: 30000000 },
    ];
    const result = selectAlbumFiles(rdFiles, 'Artist', 'Target Album');
    expect(result.fileIds).toEqual([3, 4]);
    expect(result.isDiscography).toBe(true);
  });

  test('strips year and brackets from folder names when matching', () => {
    const rdFiles = [
      { id: 1, path: 'Complete/OK Computer [1997] [FLAC]/01.flac', bytes: 30000000 },
      { id: 2, path: 'Complete/OK Computer [1997] [FLAC]/02.flac', bytes: 30000000 },
      { id: 3, path: 'Complete/The Bends [1995] [FLAC]/01.flac', bytes: 30000000 },
    ];
    const result = selectAlbumFiles(rdFiles, 'Radiohead', 'OK Computer');
    expect(result.fileIds).toEqual([1, 2]);
  });

  test('flat folder with all audio returns all files', () => {
    const rdFiles = [
      { id: 1, path: '01 - Track.flac', bytes: 30000000 },
      { id: 2, path: '02 - Track.flac', bytes: 30000000 },
      { id: 3, path: 'cover.jpg', bytes: 500000 },
    ];
    const result = selectAlbumFiles(rdFiles, 'Artist', 'Album');
    expect(result.fileIds).toEqual([1, 2]);
    expect(result.isDiscography).toBe(false);
  });

  test('multiple folders with no match returns empty', () => {
    const rdFiles = [
      { id: 1, path: 'Other Artist/Album A/01.flac', bytes: 30000000 },
      { id: 2, path: 'Other Artist/Album B/01.flac', bytes: 30000000 },
    ];
    const result = selectAlbumFiles(rdFiles, 'Target Artist', 'Target Album');
    expect(result.fileIds).toEqual([]);
    expect(result.noMatch).toBe(true);
  });

  test('filters non-audio extensions', () => {
    const rdFiles = [
      { id: 1, path: 'Album/01.flac', bytes: 30000000 },
      { id: 2, path: 'Album/info.nfo', bytes: 1000 },
      { id: 3, path: 'Album/cover.jpg', bytes: 500000 },
      { id: 4, path: 'Album/album.cue', bytes: 2000 },
    ];
    const result = selectAlbumFiles(rdFiles, 'Artist', 'Album');
    expect(result.fileIds).toEqual([1]);
  });

  test('case-insensitive matching', () => {
    const rdFiles = [
      { id: 1, path: 'ARTIST DISCOGRAPHY/target album/01.FLAC', bytes: 30000000 },
      { id: 2, path: 'ARTIST DISCOGRAPHY/other album/01.FLAC', bytes: 30000000 },
    ];
    const result = selectAlbumFiles(rdFiles, 'Artist', 'Target Album');
    expect(result.fileIds).toEqual([1]);
  });
});
