const express = require('express');
const rd = require('../services/realdebrid');
const { parseArtistAlbum, sanitizePath, isAudioFile, isArchive, extractArchive, downloadFile } = require('../services/downloader');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function fileId(filepath) {
  return crypto.createHash('md5').update(filepath).digest('hex');
}

const router = express.Router();
const MUSIC_DIR = '/app/music';

// Track the active download so it can be cancelled
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
  const { magnetLink, name, mbid, coverArt, year, artist: metaArtist, albumName: metaAlbum } = req.body;

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
    } catch {}
  }

  function checkCancelled() {
    if (abort.signal.aborted) {
      throw new Error('Download cancelled');
    }
  }

  console.log(`\n=== Starting download pipeline for: ${name || 'Unknown'} ===`);

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
      destDir = path.join(MUSIC_DIR, destArtist, destAlbum);
    } else {
      const parsed = parseArtistAlbum(torrentName);
      if (parsed) {
        destArtist = parsed.artist;
        destAlbum = parsed.album;
        destDir = path.join(MUSIC_DIR, parsed.artist, parsed.album);
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
          downloadedFiles.push(...extractedAudio);

          send('file', {
            step: 4,
            message: `Extracted ${extractedAudio.length} audio file(s) from ${filename}`,
            fileIndex: i + 1,
            fileTotal: totalLinks,
            filename,
            done: true,
            trackId: extractedAudio.length > 0 ? fileId(extractedAudio[0]) : null,
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
    if (mbid || coverArt || year) {
      const metadata = { mbid: mbid || null, coverArt: coverArt || null, year: year || null };
      try {
        fs.writeFileSync(path.join(destDir, '.metadata.json'), JSON.stringify(metadata, null, 2));
      } catch (metaErr) {
        console.warn(`Could not write .metadata.json: ${metaErr.message}`);
      }
    }

    // Pre-warm album art cache
    try {
      const warmUrl = `http://localhost:3000/api/cover/search?artist=${encodeURIComponent(destArtist)}&album=${encodeURIComponent(destAlbum)}`;
      fetch(warmUrl, { signal: AbortSignal.timeout(10000) }).catch(() => {});
    } catch {}

    send('complete', {
      message: `Done! ${downloadedFiles.length} track(s) added to library.`,
      name: name || torrentInfo.filename,
      artist: destArtist || '_unsorted',
      album: destAlbum || sanitizePath(torrentName),
      fileCount: downloadedFiles.length,
    });
  } catch (err) {
    if (err.message === 'Download cancelled') {
      console.log('Download cancelled by user.');
      send('cancelled', { message: 'Download cancelled.' });
    } else {
      console.error(`Pipeline error: ${err.message}`);
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
let bgDownload = null; // { status, name, artist, album, progress, message, error, fileCount }

router.get('/download/background/status', (req, res) => {
  if (!bgDownload) return res.json({ active: false });
  res.json({ active: bgDownload.status === 'active', ...bgDownload });
});

router.post('/download/background', async (req, res) => {
  const { magnetLink, name, mbid, coverArt, year, artist: metaArtist, albumName: metaAlbum } = req.body;
  if (!magnetLink) return res.status(400).json({ error: 'Missing magnetLink' });

  // If a foreground download is active, reject
  if (activeDownload) return res.status(409).json({ error: 'Foreground download in progress' });
  // If a background download is active, reject
  if (bgDownload?.status === 'active') return res.status(409).json({ error: 'Background download in progress' });

  bgDownload = { status: 'active', name: name || 'Unknown', artist: metaArtist, album: metaAlbum, progress: 0, message: 'Starting...', error: null, fileCount: 0 };
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
        destDir = path.join(MUSIC_DIR, destArtist, destAlbum);
      } else {
        const torrentName = torrentInfo.filename || 'Unknown';
        const parsed = parseArtistAlbum(torrentName);
        if (parsed) { destArtist = parsed.artist; destAlbum = parsed.album; destDir = path.join(MUSIC_DIR, parsed.artist, parsed.album); }
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
          downloadedFiles.push(...extracted);
        } else if (isAudioFile(filename)) {
          const destPath = path.join(destDir, sanitizePath(filename));
          await downloadFile(unrestricted.download, destPath);
          downloadedFiles.push(destPath);
        }
      }

      // Write metadata
      if (mbid || coverArt || year) {
        try { fs.writeFileSync(path.join(destDir, '.metadata.json'), JSON.stringify({ mbid, coverArt, year, source: 'torrent' }, null, 2)); } catch {}
      }

      // Pre-warm cover art
      try { fetch(`http://localhost:3000/api/cover/search?artist=${encodeURIComponent(destArtist)}&album=${encodeURIComponent(destAlbum)}`, { signal: AbortSignal.timeout(10000) }).catch(() => {}); } catch {}

      bgDownload.status = 'done';
      bgDownload.progress = 100;
      bgDownload.message = `Done! ${downloadedFiles.length} tracks saved.`;
      bgDownload.fileCount = downloadedFiles.length;
      console.log(`[bg-torrent] Done: ${name} → ${downloadedFiles.length} files`);
    } catch (err) {
      bgDownload.status = 'error';
      bgDownload.error = err.message;
      bgDownload.message = `Error: ${err.message}`;
      console.error(`[bg-torrent] Error: ${err.message}`);
    }
  })();
});

module.exports = router;
