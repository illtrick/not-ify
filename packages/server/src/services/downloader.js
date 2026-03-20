const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { createExtractorFromFile } = require('node-unrar-js');
const AdmZip = require('adm-zip');
const { getProxyFetch, recordFailure } = require('./proxy');

const MUSIC_DIR = process.env.MUSIC_DIR || '/app/music';
const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.ogg', '.m4a', '.aac', '.wav', '.opus']);
const ARCHIVE_EXTENSIONS = new Set(['.rar', '.zip']);

let _activeDownloads = 0;
let _lastCompletedAt = null;
let _lastFailedAt = null;
let _lastDownloadError = null;

async function downloadFile(url, destPath, { inactivityTimeout = 60000 } = {}) {
  _activeDownloads++;
  try {
  const dir = path.dirname(destPath);
  fs.mkdirSync(dir, { recursive: true });

  const proxyFetch = getProxyFetch();
  const res = await proxyFetch(url);
  if (!res.ok) {
    recordFailure('download', `${res.status} ${res.statusText}`);
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }

  const totalBytes = parseInt(res.headers.get('content-length') || '0', 10);
  let downloadedBytes = 0;

  const fileStream = fs.createWriteStream(destPath);
  const reader = res.body.getReader();

  try {
    while (true) {
      // Race the read against an inactivity timer so a stalled stream is aborted promptly.
      const stallError = new Error(`Download stalled: no data for ${inactivityTimeout}ms`);
      let stallTimer;
      const stallPromise = new Promise((_, reject) => {
        stallTimer = setTimeout(() => reject(stallError), inactivityTimeout);
      });

      let chunk;
      try {
        chunk = await Promise.race([reader.read(), stallPromise]);
      } catch (err) {
        reader.cancel();
        throw err;
      } finally {
        clearTimeout(stallTimer);
      }

      const { done, value } = chunk;
      if (done) break;
      fileStream.write(value);
      downloadedBytes += value.length;
      if (totalBytes > 0) {
        const pct = ((downloadedBytes / totalBytes) * 100).toFixed(1);
        process.stdout.write(`\rDownloading: ${pct}% (${formatBytes(downloadedBytes)}/${formatBytes(totalBytes)})`);
      }
    }
  } finally {
    fileStream.end();
    await new Promise(resolve => fileStream.on('finish', resolve));
  }

  if (totalBytes > 0) console.log('');
  _lastCompletedAt = Date.now();
  return destPath;
  } catch (err) {
    _lastFailedAt = Date.now();
    _lastDownloadError = err.message;
    throw err;
  } finally {
    _activeDownloads--;
  }
}

function isAudioFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return AUDIO_EXTENSIONS.has(ext);
}

function sanitizePath(str) {
  return str.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim();
}

function parseArtistAlbum(torrentName) {
  // Common patterns: "Artist - Album (Year) [Format]" or "Artist - Album [Format]"
  const cleaned = torrentName
    .replace(/\[.*?\]/g, '')   // remove [FLAC], [320], etc.
    .replace(/\(.*?\)/g, '')   // remove (2024), (Deluxe), etc.
    .replace(/\{.*?\}/g, '')
    .trim();

  const dashMatch = cleaned.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (dashMatch) {
    const artist = sanitizePath(dashMatch[1].trim());
    const album = sanitizePath(dashMatch[2].trim());
    if (artist && album) {
      return { artist, album };
    }
  }

  return null;
}

async function downloadAlbum(torrentInfo, rdService) {
  const torrentName = torrentInfo.filename || torrentInfo.original_filename || 'Unknown';
  const parsed = parseArtistAlbum(torrentName);

  let destDir;
  if (parsed) {
    destDir = path.join(MUSIC_DIR, parsed.artist, parsed.album);
  } else {
    destDir = path.join(MUSIC_DIR, '_unsorted', sanitizePath(torrentName));
  }

  fs.mkdirSync(destDir, { recursive: true });

  const links = torrentInfo.links || [];
  const downloadedFiles = [];

  for (const link of links) {
    try {
      const unrestricted = await rdService.unrestrictLink(link);
      const filename = unrestricted.filename;

      if (!isAudioFile(filename)) {
        console.log(`Skipping non-audio: ${filename}`);
        continue;
      }

      const destPath = path.join(destDir, sanitizePath(filename));
      console.log(`Downloading: ${filename}`);
      await downloadFile(unrestricted.download, destPath);
      downloadedFiles.push(destPath);
    } catch (err) {
      console.error(`Failed to download link ${link}: ${err.message}`);
    }
  }

  return {
    directory: destDir,
    files: downloadedFiles,
    artist: parsed?.artist || '_unsorted',
    album: parsed?.album || sanitizePath(torrentName),
  };
}

function isArchive(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ARCHIVE_EXTENSIONS.has(ext);
}

async function extractArchive(archivePath, destDir) {
  const ext = path.extname(archivePath).toLowerCase();
  fs.mkdirSync(destDir, { recursive: true });
  const audioFiles = [];

  try {
    if (ext === '.rar') {
      const extractor = await createExtractorFromFile({ filepath: archivePath, targetPath: destDir });
      const { files } = extractor.extract();
      for (const file of files) {
        if (file.fileHeader && !file.fileHeader.flags.directory) {
          const fullPath = path.join(destDir, file.fileHeader.name);
          if (isAudioFile(file.fileHeader.name)) {
            audioFiles.push(fullPath);
          }
        }
      }
    } else if (ext === '.zip') {
      const zip = new AdmZip(archivePath);
      zip.extractAllTo(destDir, true);
      // Walk extracted files to find audio
      walkDir(destDir, audioFiles);
    }
  } catch (err) {
    throw new Error(`Extraction failed for ${path.basename(archivePath)}: ${err.message}`);
  }

  // Clean up the archive file
  try { fs.unlinkSync(archivePath); } catch {}

  console.log(`Extracted ${audioFiles.length} audio file(s)`);
  return audioFiles;
}

function walkDir(dir, audioFiles) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, audioFiles);
    } else if (isAudioFile(entry.name)) {
      audioFiles.push(full);
    }
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getStatus() {
  return { activeDownloads: _activeDownloads, lastCompletedAt: _lastCompletedAt, lastFailedAt: _lastFailedAt, lastError: _lastDownloadError };
}

module.exports = {
  downloadFile,
  downloadAlbum,
  isAudioFile,
  isArchive,
  extractArchive,
  formatBytes,
  parseArtistAlbum,
  sanitizePath,
  getStatus,
};
