'use strict';

const crypto = require('crypto');

/**
 * Normalize a string for ID generation and matching.
 * Handles Unicode edge cases (German ß → ss, Turkish ı → i) by
 * uppercasing first (expands ß→SS, ı→I), then lowercasing,
 * then stripping non-alphanumeric.
 */
function normalize(s) {
  return (s || '').toUpperCase().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Generate a stable track ID from content metadata.
 * ID survives format upgrades (MP3 → FLAC) because it's based on
 * (artist, album, title) not filepath.
 *
 * @param {string} artist
 * @param {string} album
 * @param {string} title
 * @param {number} discriminator - For duplicate titles in same album (0 = no suffix)
 * @returns {string} 16 hex char ID
 */
function generateTrackId(artist, album, title, discriminator = 0) {
  const key = normalize(artist) + '|' + normalize(album) + '|' + normalize(title)
    + (discriminator > 0 ? '|' + discriminator : '');
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/**
 * Extract track number from a filename prefix.
 * Handles: "01-Title", "01 Title", "01_Title", "01.Title"
 * Returns null if no track number found.
 */
function extractTrackNumber(filename) {
  const match = filename.match(/^(\d+)[\s._-]/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Derive title from filename: strip track number prefix and extension.
 */
function titleFromFilename(filename) {
  const withoutExt = filename.replace(/\.[^.]+$/, '');
  return withoutExt.replace(/^\d+[\s._-]+/, '') || withoutExt;
}

module.exports = { generateTrackId, normalize, extractTrackNumber, titleFromFilename };
