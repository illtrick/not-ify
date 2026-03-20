'use strict';

const fs = require('fs');
const path = require('path');

const AUDIO_EXT = new Set(['.mp3', '.flac', '.ogg', '.m4a', '.aac', '.wav', '.opus']);

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

module.exports = { albumExistsInLibrary, normalize };
