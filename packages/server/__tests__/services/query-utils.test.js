'use strict';

const { cleanSearchQuery, foldDiacritics } = require('../../src/services/query-utils');

describe('cleanSearchQuery', () => {
  test('strips "(Original Motion Picture Soundtrack)"', () => {
    expect(cleanSearchQuery('Interstellar (Original Motion Picture Soundtrack)')).toBe('Interstellar');
  });

  test('strips "(Original Score)"', () => {
    expect(cleanSearchQuery('Dune (Original Score)')).toBe('Dune');
  });

  test('strips "(Deluxe Edition)"', () => {
    expect(cleanSearchQuery('OK Computer (Deluxe Edition)')).toBe('OK Computer');
  });

  test('strips "(Deluxe Version)"', () => {
    expect(cleanSearchQuery('In Rainbows (Deluxe Version)')).toBe('In Rainbows');
  });

  test('strips "(Remastered)"', () => {
    expect(cleanSearchQuery('Abbey Road (Remastered)')).toBe('Abbey Road');
  });

  test('strips "(Remastered 2009)"', () => {
    expect(cleanSearchQuery('Abbey Road (Remastered 2009)')).toBe('Abbey Road');
  });

  test('strips volume markers "Vol. 1"', () => {
    expect(cleanSearchQuery('Greatest Hits Vol. 1')).toBe('Greatest Hits');
  });

  test('strips volume markers "Volume 2"', () => {
    expect(cleanSearchQuery('Anthology Volume 2')).toBe('Anthology');
  });

  test('strips "Disc 1" markers', () => {
    expect(cleanSearchQuery('Mellon Collie Disc 1')).toBe('Mellon Collie');
  });

  test('strips bare edition markers outside parens', () => {
    expect(cleanSearchQuery('Kid A - Deluxe Edition')).toBe('Kid A');
  });

  test('strips trailing year in parens', () => {
    expect(cleanSearchQuery('Nevermind (1991)')).toBe('Nevermind');
  });

  test('strips "- Single" marker', () => {
    expect(cleanSearchQuery('Creep - Single')).toBe('Creep');
  });

  test('passes through a clean query unchanged', () => {
    expect(cleanSearchQuery('Music Has the Right to Children')).toBe('Music Has the Right to Children');
  });

  test('passes through a clean query with artist', () => {
    expect(cleanSearchQuery('Boards of Canada Geogaddi')).toBe('Boards of Canada Geogaddi');
  });

  test('returns falsy value unchanged', () => {
    expect(cleanSearchQuery('')).toBe('');
    expect(cleanSearchQuery(null)).toBe(null);
    expect(cleanSearchQuery(undefined)).toBe(undefined);
  });

  test('collapses extra whitespace', () => {
    const result = cleanSearchQuery('Dark Side   of the Moon');
    expect(result).toBe('Dark Side of the Moon');
  });
});

describe('foldDiacritics', () => {
  test('converts ø → o', () => {
    expect(foldDiacritics('Jón')).toContain('Jon');
  });

  test('converts ä → a', () => {
    expect(foldDiacritics('Mötley Crüe')).toBe('Motley Crue');
  });

  test('converts ø in the middle of a word', () => {
    expect(foldDiacritics('Björk')).toBe('Bjork');
  });

  test('converts ł → l', () => {
    expect(foldDiacritics('Włodek')).toBe('Wlodek');
  });

  test('converts æ → ae', () => {
    expect(foldDiacritics('Æon')).toBe('aeon');
  });

  test('converts ð → d', () => {
    expect(foldDiacritics('Sigurðsson')).toBe('Sigurdsson');
  });

  test('converts þ → th', () => {
    expect(foldDiacritics('þór')).toBe('thor');
  });

  test('leaves ASCII-only strings unchanged', () => {
    expect(foldDiacritics('Radiohead OK Computer flac')).toBe('Radiohead OK Computer flac');
  });

  test('handles uppercase diacritics', () => {
    expect(foldDiacritics('Motörhead')).toBe('Motorhead');
  });
});
