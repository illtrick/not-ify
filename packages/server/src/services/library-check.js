'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const db = require('./db');

const AUDIO_EXT = new Set(['.mp3', '.flac', '.ogg', '.m4a', '.aac', '.wav', '.opus']);

const QUALITY_RANK = { flac: 6, '320': 5, v0: 4, '256': 3, '192': 2, '128': 1, unknown: 0 };

function detectFileQuality(filePath) {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', '-show_format', filePath],
      { timeout: 5000 }
    );
    const info = JSON.parse(out);
    const codec = info.format?.format_name || '';
    const bitrate = parseInt(info.format?.bit_rate || '0', 10);

    if (codec.includes('flac')) return 'flac';
    if (bitrate >= 310000) return '320';
    if (bitrate >= 245000) return '256';
    if (bitrate >= 220000) return 'v0';
    if (bitrate >= 185000) return '192';
    if (bitrate >= 120000) return '128';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Probe an audio file for quality and duration.
 * Used by job-processor for upgrade quality comparisons.
 */
function probeFile(filePath) {
  const quality = detectFileQuality(filePath);
  let duration = 0;
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', '-show_format', filePath],
      { timeout: 5000 }
    );
    const info = JSON.parse(out);
    duration = Math.round(parseFloat(info.format?.duration || '0'));
  } catch {}
  return { quality, duration };
}

function getExistingQuality(artist, album) {
  const musicDir = process.env.MUSIC_DIR || '/app/music';
  const normArtist = normalize(artist);
  const normAlbum = normalize(album);

  if (!fs.existsSync(musicDir)) return null;

  let artistDirs;
  try { artistDirs = fs.readdirSync(musicDir); } catch { return null; }

  for (const artistDir of artistDirs) {
    if (normalize(artistDir) !== normArtist) continue;
    const artistPath = path.join(musicDir, artistDir);
    try { if (!fs.statSync(artistPath).isDirectory()) continue; } catch { continue; }

    let albumDirs;
    try { albumDirs = fs.readdirSync(artistPath); } catch { continue; }

    for (const albumDir of albumDirs) {
      if (normalize(albumDir) !== normAlbum) continue;
      const albumPath = path.join(artistPath, albumDir);
      try { if (!fs.statSync(albumPath).isDirectory()) continue; } catch { continue; }

      let files;
      try { files = fs.readdirSync(albumPath); } catch { continue; }

      const audioFile = files.find(f => AUDIO_EXT.has(path.extname(f).toLowerCase()));
      if (audioFile) {
        return detectFileQuality(path.join(albumPath, audioFile));
      }
    }
  }
  return null; // album not found
}

function isUpgrade(existingQuality, incomingQuality) {
  const existingRank = QUALITY_RANK[existingQuality] ?? 0;
  const incomingRank = QUALITY_RANK[incomingQuality] ?? 0;
  return incomingRank > existingRank;
}

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function albumExistsInLibrary(artist, album) {
  const musicDir = process.env.MUSIC_DIR || '/app/music';
  const normArtist = normalize(artist);
  const normAlbum = normalize(album);

  if (!fs.existsSync(musicDir)) return false;

  let artistDirs;
  try {
    artistDirs = fs.readdirSync(musicDir);
  } catch {
    return false;
  }

  for (const artistDir of artistDirs) {
    if (normalize(artistDir) !== normArtist) continue;
    const artistPath = path.join(musicDir, artistDir);
    try {
      if (!fs.statSync(artistPath).isDirectory()) continue;
    } catch { continue; }

    let albumDirs;
    try {
      albumDirs = fs.readdirSync(artistPath);
    } catch { continue; }

    for (const albumDir of albumDirs) {
      if (normalize(albumDir) !== normAlbum) continue;
      const albumPath = path.join(artistPath, albumDir);
      try {
        if (!fs.statSync(albumPath).isDirectory()) continue;
      } catch { continue; }

      let files;
      try {
        files = fs.readdirSync(albumPath);
      } catch { continue; }

      if (files.some(f => AUDIO_EXT.has(path.extname(f).toLowerCase()))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Count audio files in a library album directory.
 * Uses the same normalize + readdirSync dir-walking pattern as albumExistsInLibrary.
 * @returns {number} count of audio files, or 0 if album not found
 */
function albumTrackCount(artist, album) {
  const musicDir = process.env.MUSIC_DIR || '/app/music';
  const normArtist = normalize(artist);
  const normAlbum = normalize(album);

  if (!fs.existsSync(musicDir)) return 0;

  let artistDirs;
  try { artistDirs = fs.readdirSync(musicDir); } catch { return 0; }

  for (const artistDir of artistDirs) {
    if (normalize(artistDir) !== normArtist) continue;
    const artistPath = path.join(musicDir, artistDir);
    try { if (!fs.statSync(artistPath).isDirectory()) continue; } catch { continue; }

    let albumDirs;
    try { albumDirs = fs.readdirSync(artistPath); } catch { continue; }

    for (const albumDir of albumDirs) {
      if (normalize(albumDir) !== normAlbum) continue;
      const albumPath = path.join(artistPath, albumDir);
      try { if (!fs.statSync(albumPath).isDirectory()) continue; } catch { continue; }

      let files;
      try { files = fs.readdirSync(albumPath); } catch { continue; }

      return files.filter(f => AUDIO_EXT.has(path.extname(f).toLowerCase())).length;
    }
  }
  return 0;
}

/**
 * Count excluded tracks for a library album (from .metadata.json).
 * Uses the same normalize + readdirSync dir-walking pattern as albumExistsInLibrary.
 * @returns {number} length of the excluded array, or 0 if not found
 */
function excludedTrackCount(artist, album) {
  const musicDir = process.env.MUSIC_DIR || '/app/music';
  const normArtist = normalize(artist);
  const normAlbum = normalize(album);

  if (!fs.existsSync(musicDir)) return 0;

  let artistDirs;
  try { artistDirs = fs.readdirSync(musicDir); } catch { return 0; }

  for (const artistDir of artistDirs) {
    if (normalize(artistDir) !== normArtist) continue;
    const artistPath = path.join(musicDir, artistDir);
    try { if (!fs.statSync(artistPath).isDirectory()) continue; } catch { continue; }

    let albumDirs;
    try { albumDirs = fs.readdirSync(artistPath); } catch { continue; }

    for (const albumDir of albumDirs) {
      if (normalize(albumDir) !== normAlbum) continue;
      const albumPath = path.join(artistPath, albumDir);
      try { if (!fs.statSync(albumPath).isDirectory()) continue; } catch { continue; }

      try {
        const metaPath = path.join(albumPath, '.metadata.json');
        if (!fs.existsSync(metaPath)) return 0;
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        return Array.isArray(meta.excluded) ? meta.excluded.length : 0;
      } catch {
        return 0;
      }
    }
  }
  return 0;
}

/**
 * Resolve the destination directory for an album download.
 * Uses layered identity: rgid (DB index) → normalized name (DB) → new folder.
 * Never scans the filesystem — only indexed DB lookups.
 */
function resolveAlbumDir(rgid, artist, album) {
  const musicDir = process.env.MUSIC_DIR || '/app/music';

  // Layer 1: rgid lookup (O(1), indexed)
  // albums table uses album_artist/title columns, not artist/album
  if (rgid) {
    const existing = db.getAlbumByRgid(rgid);
    if (existing) {
      const dir = path.join(musicDir, existing.album_artist, existing.title);
      if (fs.existsSync(dir)) return dir;
    }
  }

  // Layer 2: normalized name DB query
  if (artist && album) {
    const match = db.findAlbumByNormalizedName(artist, album);
    if (match) {
      const dir = path.join(musicDir, match.artist, match.album);
      if (fs.existsSync(dir)) return dir;
    }
  }

  // Layer 3: new album — sanitized path
  const sanitize = (s) => (s || 'Unknown').replace(/[:]/g, '-').replace(/[<>"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim();
  return path.join(musicDir, sanitize(artist), sanitize(album));
}

module.exports = { albumExistsInLibrary, albumTrackCount, excludedTrackCount, normalize, QUALITY_RANK, getExistingQuality, isUpgrade, resolveAlbumDir, probeFile };
