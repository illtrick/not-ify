'use strict';

// ── Shared query-cleaning utilities ─────────────────────────────────────────
// Used by both api/search.js (interactive search) and services/search.js
// (upgrade / fallback query generation).

// Parenthetical content to strip (case-insensitive)
const PAREN_STRIP_RE = /\s*\((?:Original\s+(?:Motion\s+Picture\s+|Game\s+)?Soundtrack|Original\s+Score|Deluxe\s*(?:Version|Edition)?|Remaster(?:ed)?(?:\s+\d{4})?|Expanded\s+Edition|Special\s+Edition|Anniversary\s+Edition|Collector'?s?\s+Edition|Limited\s+Edition|Bonus\s+Track\s+(?:Version|Edition)|Apple\s+TV\+?[^)]*|Official\s+[^)]*|feat\.\s+[^)]*|ft\.\s+[^)]*|with\s+[^)]*|Live\s+(?:at|from|in)\s+[^)]*)\)\s*/gi;

// Volume / disc markers (covers "Vol. 1", "Vols. 4, 5, & 6", "Volume 2", "Disc 1", "CD2")
const VOL_RE = /\s*,?\s*Vols?\.\s*[\d,\s&]+|\s*Vol(?:ume)?\.?\s*\d+(?:\s*[,&]\s*\d+)*|\s*Disc\s+\d+|\s*CD\s*\d+/gi;

// Edition markers (not in parens)
const EDITION_RE = /\s*[-–—]?\s*(?:Deluxe|Special|Anniversary|Expanded|Collector'?s?|Limited|Super\s+Deluxe|Complete)\s+Edition\b/gi;

// Single/EP markers
const SINGLE_EP_RE = /\s*[-–—]\s*(?:Single|EP)\s*$/gi;

// Trailing year in parens: (1997), (2024)
const TRAILING_YEAR_RE = /\s*\(\d{4}\)\s*$/g;

// Subtitle after colon (only strip if the colon part contains known noise like "Vol.", "Soundtrack", etc.)
const NOISY_SUBTITLE_RE = /\s*:\s*(?:Vol(?:ume)?\.?\s*\d+|Original\s+(?:Motion\s+Picture\s+)?Soundtrack|Music\s+from|Deluxe|Remaster(?:ed)?|Complete\s+Edition)[^]*/gi;

/**
 * Fold diacritics for torrent search (ø→o, ä→a, etc.)
 * @param {string} s
 * @returns {string}
 */
function foldDiacritics(s) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ø/gi, 'o')
    .replace(/æ/gi, 'ae')
    .replace(/ð/gi, 'd')
    .replace(/þ/gi, 'th')
    .replace(/ł/gi, 'l');
}

/**
 * Strip edition/soundtrack/volume noise from an album name before searching.
 * Returns a trimmed string; returns the original value unchanged if it is falsy.
 * @param {string} q
 * @returns {string}
 */
function cleanSearchQuery(q) {
  if (!q) return q;
  let cleaned = q;
  // Strip parenthetical noise
  cleaned = cleaned.replace(PAREN_STRIP_RE, ' ');
  // Strip any remaining parens that are purely years
  cleaned = cleaned.replace(TRAILING_YEAR_RE, '');
  // Strip noisy subtitle after colon
  cleaned = cleaned.replace(NOISY_SUBTITLE_RE, '');
  // Strip volume/disc markers
  cleaned = cleaned.replace(VOL_RE, ' ');
  // Strip edition markers
  cleaned = cleaned.replace(EDITION_RE, '');
  // Strip single/EP markers
  cleaned = cleaned.replace(SINGLE_EP_RE, '');
  // Collapse whitespace
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
  return cleaned;
}

module.exports = {
  PAREN_STRIP_RE,
  VOL_RE,
  EDITION_RE,
  SINGLE_EP_RE,
  TRAILING_YEAR_RE,
  NOISY_SUBTITLE_RE,
  foldDiacritics,
  cleanSearchQuery,
};
