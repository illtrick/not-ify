'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const AUDIO_EXT = new Set(['.mp3', '.flac', '.ogg', '.m4a', '.aac', '.wav', '.opus']);

const QUALITY_RANK = { flac: 6, '320': 5, v0: 4, '256': 3, '192': 2, '128': 1, unknown: 0 };

/**
 * Probe an audio file with ffprobe, returning quality tier and duration.
 * Single ffprobe call extracts both codec/bitrate (for quality) and duration.
 * @param {string} filePath
 * @returns {{ quality: string, duration: number }} quality tier + duration in seconds
 */
function probeFile(filePath) {
  try {
    const out = execSync(
      `ffprobe -v quiet -print_format json -show_format "${filePath}"`,
      { timeout: 5000 }
    );
    const info = JSON.parse(out);
    const codec = info.format?.format_name || '';
    const bitrate = parseInt(info.format?.bit_rate || '0', 10);
    const duration = parseFloat(info.format?.duration || '0');

    let quality;
    if (codec.includes('flac')) quality = 'flac';
    else if (bitrate >= 310000) quality = '320';
    else if (bitrate >= 245000) quality = '256';
    else if (bitrate >= 220000) quality = 'v0';
    else if (bitrate >= 185000) quality = '192';
    else if (bitrate >= 120000) quality = '128';
    else quality = 'unknown';

    return { quality, duration };
  } catch {
    return { quality: 'unknown', duration: 0 };
  }
}

/**
 * Detect quality tier of an audio file (backward-compatible wrapper).
 * @param {string} filePath
 * @returns {string} quality tier
 */
function detectFileQuality(filePath) {
  return probeFile(filePath).quality;
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

module.exports = { albumExistsInLibrary, normalize, QUALITY_RANK, getExistingQuality, isUpgrade, probeFile, detectFileQuality };
