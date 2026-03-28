const express = require('express');
const rd = require('../services/realdebrid');
const { parseArtistAlbum, sanitizePath, isAudioFile, isArchive, extractArchive, downloadFile } = require('../services/downloader');
const { validateFile } = require('../services/file-validator');
const { generateTrackId, titleFromFilename } = require('../services/track-id');
const activity = require('../services/activity-log');
const { resolveAlbumDir } = require('../services/library-check');
const path = require('path');
const fs = require('fs');

// Lazy-load job-queue to avoid triggering its schema initialisation at module
// load time (which requires a real SQLite connection, unavailable in unit tests)
function getJobQueue() {
  return require('../services/job-queue');
}

function fileId(filepath) {
  // Generate stable track ID from filepath metadata
  const filename = path.basename(filepath);
  const parts = filepath.split(path.sep);
  const artist = parts.length >= 3 ? parts[parts.length - 3] : 'Unknown Artist';
  const album = parts.length >= 2 ? parts[parts.length - 2] : 'Unknown Album';
  const title = titleFromFilename(filename);
  return generateTrackId(artist, album, title);
}

const router = express.Router();
const MUSIC_DIR = process.env.MUSIC_DIR || '/app/music';

// Single active download at a time (by design — single-user home server).
// Multi-user support would require a Map keyed by userId.
let activeDownload = null; // { abort: AbortController, torrentId, name }

// DELETE /api/download — Cancel the active download
router.delete('/download', (req, res) => {
  if (!activeDownload) {
    return res.json({ status: 'nothing_to_cancel' });
  }
  console.log(`Cancelling download: ${activeDownload.name}`);
  activeDownload.abort.abort();

  // Try to delete the torrent from RD (fire-and-forget)
  if (activeDownload.torrentId) {
    rd.deleteTorrent(activeDownload.torrentId).catch(() => {});
  }

  res.json({ status: 'cancelled' });
});

// POST /api/download — Full pipeline with SSE progress streaming
router.post('/download', async (req, res) => {
  const { magnetLink, name, mbid, coverArt, year, artist: metaArtist, albumName: metaAlbum, rgid } = req.body;

  if (!magnetLink) {
    return res.status(400).json({ error: 'Missing magnetLink in request body' });
  }

  if (activeDownload) {
    return res.status(409).json({ error: 'A download is already in progress. Cancel it first.' });
  }

  const abort = new AbortController();
  activeDownload = { abort, torrentId: null, name: name || 'Unknown' };

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // If client disconnects mid-download, abort
  let pipelineDone = false;
  res.on('close', () => {
    if (!pipelineDone && activeDownload?.abort === abort) {
      console.log('Client disconnected, aborting download.');
      abort.abort();
    }
  });

  function send(type, data) {
    if (abort.signal.aborted) return;
    try {
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    } catch (err) {
      console.warn(`[pipeline] SSE write failed: ${err.message}`);
    }
  }

  function checkCancelled() {
    if (abort.signal.aborted) {
      throw new Error('Download cancelled');
    }
  }

  activity.log('torrent', 'info', `Starting download: ${metaArtist || ''} — ${metaAlbum || name || 'Unknown'}`, { artist: metaArtist, album: metaAlbum });

  try {
    // Step 1: Add magnet to Real-Debrid
    checkCancelled();
    send('step', { step: 1, total: 4, message: 'Adding magnet to Real-Debrid...' });
    const magnet = await rd.addMagnet(magnetLink);
    const torrentId = magnet.id;
    activeDownload.torrentId = torrentId;
    send('step', { step: 1, total: 4, message: `Magnet added. Torrent ID: ${torrentId}` });

    // Step 2: Select all files
    checkCancelled();
    send('step', { step: 2, total: 4, message: 'Selecting files...' });
    await rd.selectFiles(torrentId);
    send('step', { step: 2, total: 4, message: 'Files selected.' });

    // Step 3: Wait for RD to finish downloading — poll with progress
    checkCancelled();
    send('step', { step: 3, total: 4, message: 'Waiting for Real-Debrid to cache...' });

    const timeoutMs = 5 * 60 * 1000;
    const start = Date.now();
    let torrentInfo;

    while (Date.now() - start < timeoutMs) {
      checkCancelled();
      torrentInfo = await rd.getTorrentInfo(torrentId);

      if (torrentInfo.status === 'downloaded') {
        break;
      }
      if (torrentInfo.status === 'dead' || torrentInfo.status === 'error') {
        throw new Error(`Torrent failed with status: ${torrentInfo.status}`);
      }

      const pct = torrentInfo.progress || 0;
      const speed = torrentInfo.speed ? `${(torrentInfo.speed / 1024 / 1024).toFixed(1)} MB/s` : '';
      send('progress', {
        step: 3,
        total: 4,
        message: `Real-Debrid caching: ${pct}%${speed ? ' @ ' + speed : ''}`,
        percent: pct,
        status: torrentInfo.status,
      });

      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 2000);
        abort.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Download cancelled')); }, { once: true });
      });
    }

    if (!torrentInfo || torrentInfo.status !== 'downloaded') {
      throw new Error('Torrent download timed out after 5 minutes');
    }

    send('step', { step: 3, total: 4, message: `Cached. ${torrentInfo.links.length} link(s) ready.` });

    // Step 4: Download files to local music library
    checkCancelled();
    send('step', { step: 4, total: 4, message: 'Downloading files to your library...' });

    const links = torrentInfo.links || [];
    const totalLinks = links.length;
    const downloadedFiles = [];

    const torrentName = torrentInfo.filename || torrentInfo.original_filename || 'Unknown';
    let destDir;
    let destArtist, destAlbum;
    // Prefer clean MB metadata names over parsed torrent names
    if (metaArtist && metaAlbum) {
      destArtist = sanitizePath(metaArtist);
      destAlbum = sanitizePath(metaAlbum);
      destDir = resolveAlbumDir(rgid || null, metaArtist, metaAlbum);
    } else {
      const parsed = parseArtistAlbum(torrentName);
      if (parsed) {
        destArtist = parsed.artist;
        destAlbum = parsed.album;
        destDir = resolveAlbumDir(rgid || null, parsed.artist, parsed.album);
      } else {
        destArtist = '_unsorted';
        destAlbum = sanitizePath(torrentName);
        destDir = path.join(MUSIC_DIR, '_unsorted', sanitizePath(torrentName));
      }
    }
    fs.mkdirSync(destDir, { recursive: true });

    for (let i = 0; i < links.length; i++) {
      checkCancelled();
      try {
        const unrestricted = await rd.unrestrictLink(links[i]);
        const filename = unrestricted.filename;

        if (isArchive(filename)) {
          // Download archive, then extract audio files from it
          const sizeStr = unrestricted.filesize ? `${(unrestricted.filesize / 1024 / 1024).toFixed(1)} MB` : '';
          send('file', {
            step: 4,
            message: `Downloading archive: ${filename}${sizeStr ? ' (' + sizeStr + ')' : ''}`,
            fileIndex: i + 1,
            fileTotal: totalLinks,
            filename,
          });

          checkCancelled();
          const archivePath = path.join(destDir, sanitizePath(filename));
          await downloadFile(unrestricted.download, archivePath);

          send('file', {
            step: 4,
            message: `Extracting: ${filename}...`,
            fileIndex: i + 1,
            fileTotal: totalLinks,
            filename,
          });

          checkCancelled();
          const extractedAudio = await extractArchive(archivePath, destDir);
          const validatedAudio = [];
          for (const audioPath of extractedAudio) {
            const validation = await validateFile(audioPath);
            if (!validation.passed) {
              console.warn('[pipeline] Extracted file failed validation, deleting:', audioPath, validation.checks);
              try { fs.unlinkSync(audioPath); } catch (e) { /* ignore */ }
            } else {
              validatedAudio.push(audioPath);
            }
          }
          downloadedFiles.push(...validatedAudio);

          send('file', {
            step: 4,
            message: `Extracted ${validatedAudio.length} audio file(s) from ${filename}`,
            fileIndex: i + 1,
            fileTotal: totalLinks,
            filename,
            done: true,
            trackId: validatedAudio.length > 0 ? fileId(validatedAudio[0]) : null,
          });
        } else if (isAudioFile(filename)) {
          // Direct audio file
          const sizeStr = unrestricted.filesize ? `${(unrestricted.filesize / 1024 / 1024).toFixed(1)} MB` : '';
          send('file', {
            step: 4,
            message: `Downloading: ${filename}${sizeStr ? ' (' + sizeStr + ')' : ''}`,
            fileIndex: i + 1,
            fileTotal: totalLinks,
            filename,
          });

          checkCancelled();
          const destPath = path.join(destDir, sanitizePath(filename));
          await downloadFile(unrestricted.download, destPath);

          const validation = await validateFile(destPath);
          if (!validation.passed) {
            console.warn('[pipeline] File failed validation, deleting:', destPath, validation.checks);
            try { fs.unlinkSync(destPath); } catch (e) { /* ignore */ }
            send('file', {
              step: 4,
              message: `Skipped (failed validation): ${filename}`,
              fileIndex: i + 1,
              fileTotal: totalLinks,
              filename,
              done: true,
            });
            continue;
          }

          downloadedFiles.push(destPath);

          send('file', {
            step: 4,
            message: `Saved: ${filename}`,
            fileIndex: i + 1,
            fileTotal: totalLinks,
            filename,
            done: true,
            trackId: fileId(destPath),
          });
        } else {
          send('file', { step: 4, message: `Skipping: ${filename}`, fileIndex: i + 1, fileTotal: totalLinks });
        }
      } catch (err) {
        if (err.message === 'Download cancelled') throw err;
        send('file', { step: 4, message: `Failed: ${links[i]} — ${err.message}`, error: true });
      }
    }

    // Write .metadata.json if we have MusicBrainz info
    if (mbid || coverArt || year || rgid) {
      const metadata = { mbid: mbid || null, rgid: rgid || null, coverArt: coverArt || null, year: year || null };
      try {
        fs.writeFileSync(path.join(destDir, '.metadata.json'), JSON.stringify(metadata, null, 2));
      } catch (metaErr) {
        console.warn(`Could not write .metadata.json: ${metaErr.message}`);
      }
    }

    // Populate cover_art_url from rgid if available
    if (rgid) {
      try {
        const db = require('../services/db');
        db.updateAlbumCoverArt(destArtist, destAlbum, `/api/cover/rg/${rgid}`);
      } catch { /* non-critical */ }
    }

    // Pre-warm album art cache
    try {
      const warmUrl = `http://localhost:3000/api/cover/search?artist=${encodeURIComponent(destArtist)}&album=${encodeURIComponent(destAlbum)}`;
      fetch(warmUrl, { signal: AbortSignal.timeout(10000) }).catch(() => {});
    } catch (err) {
      console.warn(`[pipeline] Cover art pre-warm failed: ${err.message}`);
    }

    activity.log('torrent', 'success', `Complete: ${destArtist}/${destAlbum} — ${downloadedFiles.length} tracks`, { artist: destArtist, album: destAlbum, fileCount: downloadedFiles.length });
    send('complete', {
      message: `Done! ${downloadedFiles.length} track(s) added to library.`,
      name: name || torrentInfo.filename,
      artist: destArtist || '_unsorted',
      album: destAlbum || sanitizePath(torrentName),
      fileCount: downloadedFiles.length,
    });
  } catch (err) {
    if (err.message === 'Download cancelled') {
      activity.log('torrent', 'warn', 'Download cancelled by user');
      send('cancelled', { message: 'Download cancelled.' });
    } else {
      activity.log('torrent', 'error', `Pipeline error: ${err.message}`, { error: err.message });
      send('error', { message: err.message });
    }
  } finally {
    pipelineDone = true;
    activeDownload = null;
    res.end();
  }
});

// ---------------------------------------------------------------------------
// Background torrent download — non-SSE, returns immediately, processes async
// ---------------------------------------------------------------------------
// Single background download at a time (by design — single-user home server).
let bgDownload = null; // { status, name, artist, album, progress, message, error, fileCount }

router.get('/download/background/status', (req, res) => {
  if (!bgDownload) return res.json({ active: false });
  res.json({ active: bgDownload.status === 'active', ...bgDownload });
});

router.post('/download/background', async (req, res) => {
  const { magnetLink, name, mbid, coverArt, year, artist: metaArtist, albumName: metaAlbum, rgid } = req.body;
  if (!magnetLink) return res.status(400).json({ error: 'Missing magnetLink' });

  // If a foreground download is active, reject
  if (activeDownload) return res.status(409).json({ error: 'Foreground download in progress' });
  // If a background download is active, reject
  if (bgDownload?.status === 'active') return res.status(409).json({ error: 'Background download in progress' });

  bgDownload = { status: 'active', name: name || 'Unknown', artist: metaArtist, album: metaAlbum, progress: 0, message: 'Starting...', error: null, fileCount: 0 };
  activity.log('torrent', 'info', `Background download started: ${metaArtist || ''} — ${metaAlbum || name}`, { artist: metaArtist, album: metaAlbum });

  // Persist job to queue for restart-resilience (alongside the in-memory flow)
  const dedupeKey = metaArtist && metaAlbum
    ? `download:${metaArtist}|${metaAlbum}`
    : `download:${magnetLink.slice(0, 60)}`;
  getJobQueue().enqueue('download', { magnetLink, name, mbid, coverArt, year, artist: metaArtist, album: metaAlbum, rgid: rgid || null }, { dedupeKey });

  res.json({ started: true });

  // Process in background (no await — fire and forget)
  (async () => {
    const abort = new AbortController();
    try {
      bgDownload.message = 'Adding magnet...';
      const magnet = await rd.addMagnet(magnetLink);
      const torrentId = magnet.id;

      bgDownload.message = 'Selecting files...';
      await rd.selectFiles(torrentId);

      bgDownload.message = 'Waiting for Real-Debrid cache...';
      const timeoutMs = 5 * 60 * 1000;
      const start = Date.now();
      let torrentInfo;

      while (Date.now() - start < timeoutMs) {
        torrentInfo = await rd.getTorrentInfo(torrentId);
        if (torrentInfo.status === 'downloaded') break;
        if (torrentInfo.status === 'dead' || torrentInfo.status === 'error') throw new Error(`Torrent failed: ${torrentInfo.status}`);
        bgDownload.progress = torrentInfo.progress || 0;
        bgDownload.message = `Caching: ${bgDownload.progress}%`;
        await new Promise(r => setTimeout(r, 2000));
      }

      if (!torrentInfo || torrentInfo.status !== 'downloaded') throw new Error('Torrent timed out');

      bgDownload.message = 'Downloading files...';
      bgDownload.progress = 50;

      const links = torrentInfo.links || [];
      let destArtist, destAlbum, destDir;
      if (metaArtist && metaAlbum) {
        destArtist = sanitizePath(metaArtist);
        destAlbum = sanitizePath(metaAlbum);
        destDir = resolveAlbumDir(rgid || null, metaArtist, metaAlbum);
      } else {
        const torrentName = torrentInfo.filename || 'Unknown';
        const parsed = parseArtistAlbum(torrentName);
        if (parsed) { destArtist = parsed.artist; destAlbum = parsed.album; destDir = resolveAlbumDir(rgid || null, parsed.artist, parsed.album); }
        else { destArtist = '_unsorted'; destAlbum = sanitizePath(torrentName); destDir = path.join(MUSIC_DIR, '_unsorted', destAlbum); }
      }
      fs.mkdirSync(destDir, { recursive: true });

      const downloadedFiles = [];
      for (let i = 0; i < links.length; i++) {
        const unrestricted = await rd.unrestrictLink(links[i]);
        const filename = unrestricted.filename;
        bgDownload.message = `Downloading: ${filename}`;
        bgDownload.progress = 50 + Math.round((i / links.length) * 50);

        if (isArchive(filename)) {
          const archivePath = path.join(destDir, sanitizePath(filename));
          await downloadFile(unrestricted.download, archivePath);
          const extracted = await extractArchive(archivePath, destDir);
          for (const audioPath of extracted) {
            const validation = await validateFile(audioPath);
            if (!validation.passed) {
              console.warn('[bg-pipeline] Extracted file failed validation, deleting:', audioPath, validation.checks);
              try { fs.unlinkSync(audioPath); } catch (e) { /* ignore */ }
            } else {
              downloadedFiles.push(audioPath);
            }
          }
        } else if (isAudioFile(filename)) {
          const destPath = path.join(destDir, sanitizePath(filename));
          await downloadFile(unrestricted.download, destPath);
          const validation = await validateFile(destPath);
          if (!validation.passed) {
            console.warn('[bg-pipeline] File failed validation, deleting:', destPath, validation.checks);
            try { fs.unlinkSync(destPath); } catch (e) { /* ignore */ }
          } else {
            downloadedFiles.push(destPath);
          }
        }
      }

      // Write metadata
      if (mbid || coverArt || year || rgid) {
        try { fs.writeFileSync(path.join(destDir, '.metadata.json'), JSON.stringify({ mbid, rgid: rgid || null, coverArt, year, source: 'torrent' }, null, 2)); } catch (err) { console.warn(`[bg-pipeline] Could not write .metadata.json: ${err.message}`); }
      }

      // Populate cover_art_url from rgid if available
      if (rgid) {
        try { const db = require('../services/db'); db.updateAlbumCoverArt(destArtist, destAlbum, `/api/cover/rg/${rgid}`); } catch { /* non-critical */ }
      }

      // Pre-warm cover art
      try { fetch(`http://localhost:3000/api/cover/search?artist=${encodeURIComponent(destArtist)}&album=${encodeURIComponent(destAlbum)}`, { signal: AbortSignal.timeout(10000) }).catch(() => {}); } catch (err) { console.warn(`[bg-pipeline] Cover art pre-warm failed: ${err.message}`); }

      bgDownload.status = 'done';
      bgDownload.progress = 100;
      bgDownload.message = `Done! ${downloadedFiles.length} tracks saved.`;
      bgDownload.fileCount = downloadedFiles.length;
      activity.log('torrent', 'success', `Background complete: ${destArtist}/${destAlbum} — ${downloadedFiles.length} files`, { artist: destArtist, album: destAlbum, fileCount: downloadedFiles.length });
    } catch (err) {
      bgDownload.status = 'error';
      bgDownload.error = err.message;
      bgDownload.message = `Error: ${err.message}`;
      activity.log('torrent', 'error', `Background error: ${err.message}`, { error: err.message });
    }
  })();
});

// Expose active download state for concurrency checks (used by job-processor)
router.isDownloadActive = () => activeDownload !== null;

module.exports = router;
