const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = express.Router();
const yt = require('../services/youtube');
const streamAuth = require('../services/stream-auth');
const { validateFile } = require('../services/file-validator');
const activity = require('../services/activity-log');
const downloader = require('../services/downloader');

// Read music dir from DB (set via Settings UI), fall back to env var
function getMusicDir() {
  try {
    const db = require('../services/db');
    return db.getGlobalSetting('musicDir') || process.env.MUSIC_DIR || '/app/music';
  } catch {
    return process.env.MUSIC_DIR || '/app/music';
  }
}
const MUSIC_DIR = null; // DEPRECATED — use getMusicDir() instead

function sanitizePath(s) {
  return (s || 'Unknown').replace(/[:]/g, '-').replace(/[<>"/\\|?*\x00-\x1f]/g, '_').trim() || 'Unknown';
}

function fileId(filepath) {
  return crypto.createHash('md5').update(filepath).digest('hex');
}

// Search YouTube
router.get('/yt/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing q parameter' });
  try {
    const results = await yt.searchYouTube(q);
    res.json(results);
  } catch (err) {
    console.error('YT search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Search SoundCloud
router.get('/sc/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing q parameter' });
  try {
    const results = await yt.searchSoundCloud(q);
    res.json(results);
  } catch (err) {
    console.error('SC search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// YT download queue system — concurrent pool, accepts multiple requests
// ---------------------------------------------------------------------------
// YouTube rate-limits concurrent downloads — 2 balances speed vs reliability
const YT_CONCURRENCY = parseInt(process.env.YT_CONCURRENCY || '2', 10);
const ytQueue = [];       // [{id, url, title, artist, album, coverArt, status, progress, error}]
let ytQueueProcessing = false;
let ytQueueIdCounter = 0;
const activeYtDownloads = new Map(); // id → { abort, title }

function ytQueueAdd(item) {
  const entry = { id: ++ytQueueIdCounter, ...item, status: 'queued', progress: 0, error: null };
  ytQueue.push(entry);
  ytQueueProcess().catch(err => console.error('[yt-queue] Unhandled queue error:', err.message)); // kick off processing if idle
  return entry;
}

/**
 * Check if all tracks for an album are finished and trigger upgrade if so.
 * Called after each individual track completes/errors.
 */
function triggerUpgradeIfAlbumComplete(artist, album) {
  if (!artist || !album) return;
  const albumTracks = ytQueue.filter(e => e.artist === artist && e.album === album);
  const allFinished = albumTracks.every(e => e.status === 'done' || e.status === 'error' || e.status === 'cancelled');
  if (!allFinished) return;
  if (albumTracks[0]?._upgradeTriggered) return;
  albumTracks.forEach(e => e._upgradeTriggered = true);

  try {
    const jobQueue = require('../services/job-queue');
    const dedupeKey = `upgrade:${artist}|${album}`;
    const jobId = jobQueue.enqueue('upgrade', { artist, album }, { dedupeKey, priority: 10 });
    if (jobId) {
      activity.log('youtube', 'info', `Auto-queued upgrade for ${artist} — ${album}`, { artist, album });
    }
  } catch (err) {
    console.error('[yt-queue] Failed to enqueue upgrade:', err.message);
  }
}

async function ytQueueProcess() {
  if (ytQueueProcessing) return;
  ytQueueProcessing = true;

  // Pool-based: keep up to YT_CONCURRENCY downloads active at once
  const running = new Map(); // id → Promise

  while (true) {
    // Fill available slots
    while (running.size < YT_CONCURRENCY) {
      const next = ytQueue.find(e => e.status === 'queued');
      if (!next) break;

      next.status = 'active';
      const abort = new AbortController();
      activeYtDownloads.set(next.id, { abort, title: next.title });

      const promise = ytDownloadOne(next, abort)
        .then(() => {
          next.status = 'done';
          // Sync new track to DB so library API returns it immediately
          try {
            const library = require('./library');
            library.syncAlbum(next.artist, next.album);
            library.invalidateCache();
          } catch {}
        })
        .catch(async err => {
          if (err.message === 'Download cancelled') {
            next.status = 'cancelled';
            return;
          }
          // Retry once after a 5s backoff (catches YT rate limits)
          if (!next._retried) {
            next._retried = true;
            activity.log('youtube', 'info', `Retrying: ${next.title} (${err.message})`, { title: next.title });
            await new Promise(r => setTimeout(r, 5000));
            const retryAbort = new AbortController();
            try {
              await ytDownloadOne(next, retryAbort);
              next.status = 'done';
              try {
                const library = require('./library');
                library.syncAlbum(next.artist, next.album);
                library.invalidateCache();
              } catch {}
              return;
            } catch (retryErr) {
              err = retryErr;
            }
          }
          next.status = 'error';
          next.error = err.message;
          activity.log('youtube', 'error', `Failed: ${next.title} — ${err.message}`, { title: next.title, error: err.message });
        })
        .finally(() => {
          activeYtDownloads.delete(next.id);
          running.delete(next.id);
          triggerUpgradeIfAlbumComplete(next.artist, next.album);
        });

      running.set(next.id, promise);
    }

    // No running tasks and nothing queued — we're done
    if (running.size === 0) break;

    // Wait for any one to finish, then pause briefly to avoid YT rate limits
    await Promise.race(running.values());
    await new Promise(r => setTimeout(r, 3000));
  }

  ytQueueProcessing = false;

  // Trim completed items older than 50 entries
  while (ytQueue.length > 50 && ytQueue[0].status !== 'queued' && ytQueue[0].status !== 'active') {
    ytQueue.shift();
  }
}

// Core download logic (extracted from old POST handler)
async function ytDownloadOne(entry, abort) {
  const dlTitle = entry.title || 'Unknown';
  const dlArtist = sanitizePath(entry.artist || 'Unknown Artist');
  const dlAlbum = sanitizePath(entry.album || 'Singles');

  const destDir = path.join(getMusicDir(), dlArtist, dlAlbum);
  fs.mkdirSync(destDir, { recursive: true });

  // Skip if track already exists — match by number OR by normalized title
  const trackNum = sanitizePath(dlTitle).match(/^(\d+)/)?.[1];
  if (trackNum || dlTitle) {
    try {
      const existing = fs.readdirSync(destDir);
      // Match by track number prefix
      let match = trackNum ? existing.find(f =>
        f.match(/^(\d+)/)?.[1] === trackNum && /\.(mp3|flac|ogg|m4a|opus|wav)$/i.test(f)
      ) : null;
      // Also match by normalized title (handles unnumbered files from single-track plays)
      if (!match) {
        const { normalize } = require('../services/track-id');
        const titleNorm = normalize(dlTitle.replace(/^\d+-/, ''));
        if (titleNorm) {
          match = existing.find(f => {
            if (!/\.(mp3|flac|ogg|m4a|opus|wav)$/i.test(f)) return false;
            const fTitle = normalize(f.replace(/^\d+[-_\s]*/, '').replace(/\.[^.]+$/, ''));
            return fTitle === titleNorm;
          });
        }
      }
      if (match) {
        activity.log('youtube', 'info', `Skipped (exists): ${dlTitle}`, { artist: dlArtist, album: dlAlbum, title: dlTitle });
        return path.join(destDir, match);
      }
    } catch { /* dir doesn't exist yet */ }
  }

  activity.log('youtube', 'info', `Downloading: ${dlTitle}`, { artist: dlArtist, album: dlAlbum, title: dlTitle });

  const outputTemplate = path.join(destDir, `${sanitizePath(dlTitle)}.%(ext)s`);
  const args = [
    '-x', '--audio-format', 'mp3', '--audio-quality', '0',
    '--no-warnings', '--newline',
    '-o', outputTemplate,
    entry.url,
  ];

  const downloadedFile = await new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args);
    let lastFile = '';
    let stderrBuf = '';
    let settled = false;

    // 120s hard timeout — abort via the existing AbortController so cleanup is unified
    const timeoutId = setTimeout(() => {
      if (!settled) {
        console.warn(`[yt-queue] Timeout reached for: ${dlTitle}`);
        abort.abort();
      }
    }, 120000);

    const onAbort = () => { try { proc.kill('SIGTERM'); } catch {} };
    abort.signal.addEventListener('abort', onAbort, { once: true });

    proc.stdout.on('data', (d) => {
      const line = d.toString().trim();
      const pctMatch = line.match(/\[download\]\s+([\d.]+)%/);
      if (pctMatch) entry.progress = parseFloat(pctMatch[1]);
      const destMatch = line.match(/\[(?:ExtractAudio|Merger)\] Destination: (.+)/);
      if (destMatch) lastFile = destMatch[1].trim();
      if (!lastFile) {
        const dlMatch = line.match(/Destination: (.+)/);
        if (dlMatch) lastFile = dlMatch[1].trim();
      }
    });

    proc.stderr.on('data', (d) => {
      const line = d.toString().trim();
      if (line) {
        console.error(`yt-dlp stderr: ${line}`);
        stderrBuf += line + '\n';
      }
    });

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      abort.signal.removeEventListener('abort', onAbort);
      if (abort.signal.aborted) return reject(new Error('Download cancelled'));
      if (code !== 0) {
        // Extract the most useful line from stderr for the activity log
        const reason = stderrBuf.split('\n').filter(l => l && !l.startsWith('WARNING')).pop() || `exit code ${code}`;
        return reject(new Error(reason));
      }
      if (lastFile && fs.existsSync(lastFile)) return resolve(lastFile);
      const mp3Path = path.join(destDir, `${sanitizePath(dlTitle)}.mp3`);
      if (fs.existsSync(mp3Path)) return resolve(mp3Path);
      const files = fs.readdirSync(destDir).filter(f => /\.(mp3|m4a|opus|ogg|flac|wav)$/i.test(f));
      if (files.length > 0) return resolve(path.join(destDir, files[files.length - 1]));
      reject(new Error('Download completed but no audio file found'));
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      abort.signal.removeEventListener('abort', onAbort);
      reject(err);
    });
  });

  entry.progress = 100;

  // Validate the downloaded file before accepting it into the library
  const validation = await validateFile(downloadedFile);
  if (!validation.passed) {
    console.warn('[yt-queue] File failed validation, deleting:', downloadedFile, validation.checks);
    try { fs.unlinkSync(downloadedFile); } catch (e) { /* ignore */ }
    throw new Error(`Downloaded file failed validation: ${validation.checks.filter(c => !c.passed && !c.skipped).map(c => c.name).join(', ')}`);
  }

  // Write .metadata.json
  const metadata = { coverArt: entry.coverArt || null, source: 'yt-dlp', sourceUrl: entry.url };
  try {
    const metaPath = path.join(destDir, '.metadata.json');
    let existing = {};
    if (fs.existsSync(metaPath)) {
      try { existing = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {}
    }
    fs.writeFileSync(metaPath, JSON.stringify({ ...existing, ...metadata }, null, 2));
  } catch (err) {
    console.warn(`Could not write .metadata.json: ${err.message}`);
  }

  // Write to track_files in new album schema (best-effort)
  try {
    const db = require('../services/db');
    const { generateAlbumId, generateTrackId, normalize } = require('../services/track-id');

    const albumArtist = entry.artist || 'Unknown Artist';
    const albumTitle = entry.album || 'Singles';

    let album = db.getAlbumByArtistAndTitle(albumArtist, albumTitle);
    if (!album) {
      // Album not in new schema yet — create from .metadata.json if available
      const metaPath = path.join(destDir, '.metadata.json');
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {}

      const albumId = generateAlbumId(meta.artist || albumArtist, meta.album || albumTitle, meta.rgid);
      db.upsertAlbum({
        id: albumId,
        title: meta.album || albumTitle,
        albumArtist: meta.artist || albumArtist,
        year: meta.year ? parseInt(meta.year, 10) : null,
        trackCount: meta.trackCount || (meta.mbTracks ? meta.mbTracks.length : null),
        duration: meta.mbTracks ? Math.round(meta.mbTracks.reduce((s, t) => s + (t.lengthMs || 0), 0) / 1000) : null,
        mbid: meta.mbid || null,
        rgid: meta.rgid || null,
        coverArtUrl: meta.coverArt || null,
        genres: null,
        compilation: 0,
      });

      // Create album_tracks from mbTracks if available
      if (meta.mbTracks) {
        for (const t of meta.mbTracks) {
          const trackId = generateTrackId(meta.artist || albumArtist, meta.album || albumTitle, t.title, 0);
          db.upsertAlbumTrack({
            id: trackId,
            albumId,
            title: t.title,
            artist: meta.artist || albumArtist,
            trackNumber: t.position || 0,
            discNumber: 1,
            duration: t.lengthMs ? Math.round(t.lengthMs / 1000) : null,
            mbid: null,
          });
        }
      }
      album = db.getAlbumById(albumId);
    }

    if (album) {
      // Match downloaded file to an album_track — prefer track number, fall back to title
      const trackTitle = (entry.title || '').replace(/^\d+-/, '').replace(/_/g, ' ').trim();
      const albumTracks = db.getAlbumTracks(album.id);
      const fileNum = parseInt((entry.title || '').match(/^(\d+)/)?.[1], 10);
      const matchingTrack = (fileNum && albumTracks.find(at => at.track_number === fileNum))
        || albumTracks.find(at => normalize(at.title) === normalize(trackTitle));

      if (matchingTrack) {
        const ext = path.extname(downloadedFile).replace('.', '').toLowerCase();
        console.log(`[pipeline] track_files: ${matchingTrack.title} → ${ext} (${downloadedFile})`);
        db.upsertTrackFile({
          trackId: matchingTrack.id,
          filepath: downloadedFile,
          format: ext || 'mp3',
          bitrate: null,
          fileSize: fs.statSync(downloadedFile).size,
          fileDuration: null,
          scanStatus: 'clean',
        });
      }
    }
  } catch (err) {
    console.warn('[yt-queue] Failed to write track_files:', err.message);
  }

  // Pre-warm cover art cache
  try {
    fetch(`http://localhost:3000/api/cover/search?artist=${encodeURIComponent(dlArtist)}&album=${encodeURIComponent(dlAlbum)}`, { signal: AbortSignal.timeout(10000) }).catch(() => {});
  } catch {}

  activity.log('youtube', 'success', `Saved: ${dlTitle}`, { artist: dlArtist, album: dlAlbum, title: dlTitle, path: downloadedFile });
  downloader.trackCompletion();

  // Clean up unnumbered duplicates when a numbered file is downloaded
  // e.g. "Comfortably Numb.mp3" becomes redundant when "08-Comfortably Numb.mp3" exists
  try {
    const downloadedBasename = path.basename(downloadedFile);
    const hasTrackNum = /^\d+[-_\s]/.test(downloadedBasename);
    if (hasTrackNum) {
      const { normalize } = require('../services/track-id');
      const titleOnly = normalize(downloadedBasename.replace(/^\d+[-_\s]*/, '').replace(/\.[^.]+$/, ''));
      if (titleOnly) {
        const existing = fs.readdirSync(destDir);
        for (const f of existing) {
          if (f === downloadedBasename) continue;
          if (!/\.(mp3|flac|ogg|m4a|opus|wav)$/i.test(f)) continue;
          if (/^\d+[-_\s]/.test(f)) continue; // skip other numbered files
          const fTitle = normalize(f.replace(/\.[^.]+$/, ''));
          if (fTitle === titleOnly) {
            try { fs.unlinkSync(path.join(destDir, f)); } catch {}
            activity.log('youtube', 'info', `Removed unnumbered duplicate: ${f}`, { artist: dlArtist, album: dlAlbum });
          }
        }
      }
    }
  } catch {}

  // Clean up ALL intermediate files in album directory (not just matching baseName)
  // yt-dlp may rename outputs, leaving orphaned .webm/.part/.temp files behind
  try {
    const intermediateExts = ['.webm', '.part', '.temp'];
    const allFiles = fs.readdirSync(destDir);
    for (const f of allFiles) {
      const ext = path.extname(f).toLowerCase();
      if (intermediateExts.includes(ext)) {
        try { fs.unlinkSync(path.join(destDir, f)); } catch {}
      }
    }
  } catch (cleanupErr) {
    console.warn('[yt-queue] Cleanup failed:', cleanupErr.message);
  }

  return downloadedFile;
}

// DELETE /api/download/yt — Cancel active yt-dlp download(s)
// ?id=123 cancels a specific download; omit to cancel all active + queued
router.delete('/download/yt', (req, res) => {
  const targetId = req.query.id ? parseInt(req.query.id, 10) : null;

  if (targetId) {
    // Cancel a specific download
    const dl = activeYtDownloads.get(targetId);
    if (dl) {
      console.log(`Cancelling yt-dlp download #${targetId}: ${dl.title}`);
      dl.abort.abort();
      return res.json({ status: 'cancelled', id: targetId });
    }
    // Maybe it's still queued
    const queued = ytQueue.find(e => e.id === targetId && e.status === 'queued');
    if (queued) {
      queued.status = 'cancelled';
      return res.json({ status: 'cancelled', id: targetId });
    }
    return res.json({ status: 'not_found', id: targetId });
  }

  // Cancel all
  if (activeYtDownloads.size === 0 && !ytQueue.some(e => e.status === 'queued')) {
    return res.json({ status: 'nothing_to_cancel' });
  }
  for (const [id, dl] of activeYtDownloads) {
    console.log(`Cancelling yt-dlp download #${id}: ${dl.title}`);
    dl.abort.abort();
  }
  ytQueue.forEach(e => { if (e.status === 'queued') e.status = 'cancelled'; });
  res.json({ status: 'cancelled' });
});

// GET /api/download/yt/queue — Queue status
router.get('/download/yt/queue', (req, res) => {
  const activeItems = ytQueue.filter(e => e.status === 'active');
  const queued = ytQueue.filter(e => e.status === 'queued');
  const completed = ytQueue.filter(e => e.status === 'done').length;
  const errors = ytQueue.filter(e => e.status === 'error').length;
  res.json({
    active: activeItems.map(e => ({ id: e.id, title: e.title, artist: e.artist, album: e.album, progress: e.progress })),
    queued: queued.map(e => ({ id: e.id, title: e.title, artist: e.artist, album: e.album })),
    completed,
    errors,
    total: ytQueue.length,
    concurrency: YT_CONCURRENCY,
  });
});

// POST /api/download/yt — Queue a single YT download (returns immediately)
router.post('/download/yt', (req, res) => {
  const { url, title, artist, album, coverArt } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  const entry = ytQueueAdd({ url, title, artist, album, coverArt });
  res.json({ queued: true, id: entry.id, position: ytQueue.filter(e => e.status === 'queued').length });
});

// POST /api/download/yt/batch — Queue multiple YT downloads
router.post('/download/yt/batch', (req, res) => {
  const { tracks } = req.body;
  if (!Array.isArray(tracks) || tracks.length === 0) return res.status(400).json({ error: 'Missing tracks array' });
  const entries = tracks.filter(t => t.url).map(t => ytQueueAdd(t));
  res.json({ queued: entries.length, ids: entries.map(e => e.id) });
});

// ytQueueAlbum — core album queue logic, usable without HTTP context
// Accepts { artist, album, tracks, mbid, rgid, coverArt }
// Returns { queued, failed, total }
async function ytQueueAlbum({ artist, album, tracks, mbid, rgid, coverArt, year }) {
  if (!artist || !album) throw new Error('Missing artist or album');
  if (!Array.isArray(tracks) || tracks.length === 0) throw new Error('Missing tracks array');

  // Ensure year is populated — fall back to album schema if client didn't send it
  let albumYear = year;
  if (!albumYear && rgid) {
    try {
      const db = require('../services/db');
      const existingAlbum = db.getAlbumByRgid(rgid);
      if (existingAlbum?.year) albumYear = existingAlbum.year;
    } catch {}
  }

  const safeArtist = sanitizePath(artist);
  const safeAlbum = sanitizePath(album);

  // For each track, search YouTube and queue download
  const queued = [];
  const errors = [];

  for (const track of tracks) {
    const trackTitle = track.title || track.name;
    if (!trackTitle) continue;

    // Skip non-music tracks (silence, data tracks, hidden tracks with no real title)
    const titleLower = trackTitle.toLowerCase().trim();
    let skipReason = null;
    if (titleLower === '[silence]' || titleLower === 'silence') skipReason = 'silence';
    else if (titleLower === '[data track]' || titleLower === 'data track') skipReason = 'data track';
    else if (titleLower === '[untitled]' || titleLower === '') skipReason = 'no title';
    else if (track.lengthMs && track.lengthMs < 500) skipReason = `too short (${track.lengthMs}ms)`; // <0.5 seconds (data tracks, silence)
    if (skipReason) {
      activity.log('youtube', 'info', `Skipped: "${trackTitle}" (${skipReason})`, { artist, album, title: trackTitle });
      continue;
    }

    const position = track.position || (queued.length + errors.length + 1);
    const paddedPos = String(position).padStart(2, '0');

    try {
      // Search YouTube for this specific track
      const searchQuery = `${artist} ${trackTitle}`;
      const ytResults = await yt.searchYouTube(searchQuery, 10).catch(() => []);

      if (ytResults.length === 0) {
        errors.push({ track: trackTitle, error: 'No YouTube results' });
        continue;
      }

      // Score results: prefer title/channel match + duration proximity
      const trackLengthSec = track.lengthMs ? track.lengthMs / 1000 : null;
      const artistLow = artist.toLowerCase();
      const titleLow = trackTitle.toLowerCase();

      function scoreResult(r) {
        let score = 0;
        const rTitle = (r.title || '').toLowerCase();
        const rChannel = (r.channel || '').toLowerCase();
        // Strong bonus: title or channel contains artist name
        if (rTitle.includes(artistLow) || rChannel.includes(artistLow)) score += 50;
        // Bonus: title contains track name
        if (rTitle.includes(titleLow)) score += 30;
        // Penalty: very long videos (likely compilations/mixes)
        if (r.duration && r.duration > 600) score -= 20;
        if (r.duration && r.duration > 1200) score -= 30;
        // Duration proximity bonus (if we know expected length)
        if (trackLengthSec && r.duration) {
          const diff = Math.abs(r.duration - trackLengthSec);
          if (diff < 5) score += 25;
          else if (diff < 15) score += 15;
          else if (diff < 30) score += 5;
          else if (diff > 60) score -= 10;
        }
        return score;
      }

      const scored = ytResults.map(r => ({ ...r, _score: scoreResult(r) }));
      scored.sort((a, b) => b._score - a._score);
      const best = scored[0];

      activity.log('youtube', 'info', `Matched: "${trackTitle}" → "${best.title}" (score: ${best._score}, ${best.channel})`, { artist, title: trackTitle, ytTitle: best.title, score: best._score });

      const entry = ytQueueAdd({
        url: best.url || `https://www.youtube.com/watch?v=${best.id}`,
        title: `${paddedPos}-${sanitizePath(trackTitle)}`,
        artist: safeArtist,
        album: safeAlbum,
        coverArt: coverArt || null,
      });
      queued.push({ id: entry.id, track: trackTitle, position, ytTitle: best.title });
    } catch (err) {
      errors.push({ track: trackTitle, error: err.message });
    }
  }

  // Retry failed tracks with simplified search (just title, no artist prefix)
  if (errors.length > 0 && errors.length <= 3) {
    for (let i = errors.length - 1; i >= 0; i--) {
      const err = errors[i];
      try {
        const retryResults = await yt.searchYouTube(err.track, 5).catch(() => []);
        if (retryResults.length === 0) continue;

        const trackLengthSec = tracks.find(t => (t.title || t.name) === err.track)?.lengthMs
          ? tracks.find(t => (t.title || t.name) === err.track).lengthMs / 1000 : null;
        const artistLow = artist.toLowerCase();
        const titleLow = err.track.toLowerCase();

        function retryScore(r) {
          let score = 0;
          const rTitle = (r.title || '').toLowerCase();
          const rChannel = (r.channel || '').toLowerCase();
          if (rTitle.includes(artistLow) || rChannel.includes(artistLow)) score += 50;
          if (rTitle.includes(titleLow)) score += 30;
          if (r.duration && r.duration > 600) score -= 20;
          if (r.duration && r.duration > 1200) score -= 30;
          if (trackLengthSec && r.duration) {
            const diff = Math.abs(r.duration - trackLengthSec);
            if (diff < 5) score += 25;
            else if (diff < 15) score += 15;
            else if (diff < 30) score += 5;
            else if (diff > 60) score -= 10;
          }
          return score;
        }

        const scored = retryResults.map(r => ({ ...r, _score: retryScore(r) }));
        scored.sort((a, b) => b._score - a._score);
        const best = scored[0];

        const origTrack = tracks.find(t => (t.title || t.name) === err.track);
        const position = origTrack?.position || (queued.length + 1);
        const paddedPos = String(position).padStart(2, '0');

        activity.log('youtube', 'info', `Retry matched: "${err.track}" → "${best.title}" (score: ${best._score})`, { artist, title: err.track, ytTitle: best.title, score: best._score });

        const entry = ytQueueAdd({
          url: best.url || `https://www.youtube.com/watch?v=${best.id}`,
          title: `${paddedPos}-${sanitizePath(err.track)}`,
          artist: safeArtist,
          album: safeAlbum,
          coverArt: coverArt || null,
        });
        queued.push({ id: entry.id, track: err.track, position, ytTitle: best.title, retry: true });
        errors.splice(i, 1);
      } catch {}
    }
  }

  // Write album-level metadata
  if (queued.length > 0) {
    const destDir = path.join(getMusicDir(), safeArtist, safeAlbum);
    fs.mkdirSync(destDir, { recursive: true });
    const metaPath = path.join(destDir, '.metadata.json');
    const metadata = {
      artist,
      album,
      rgid: rgid || null,
      mbid: mbid || null,
      coverArt: coverArt || null,
      year: albumYear || null,
      source: 'yt-album-download',
      trackCount: tracks.length,
      downloadedAt: new Date().toISOString(),
      // Store MB tracklist so syncAlbum can assign track numbers to downloaded files
      // Sorted by position to ensure correct track ordering
      mbTracks: tracks.map((t, i) => ({
        position: t.position || i + 1,
        title: t.title || t.name,
        lengthMs: t.lengthMs || null,
      })).sort((a, b) => a.position - b.position),
    };
    try {
      fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
    } catch {}
  }

  if (errors.length > 0) {
    activity.log('youtube', 'warn', `Album ${artist} — ${album}: ${errors.length} tracks failed YT matching`, {
      artist, album, errors: errors.map(e => e.track),
    });
  }

  activity.log('youtube', 'info', `Album queued: ${artist} — ${album} (${queued.length} tracks, ${errors.length} failed)`, { artist, album, queued: queued.length, errors: errors.length });

  return { queued: queued.length, failed: errors.length, total: tracks.length };
}

// POST /api/download/yt/album — Album-aware YT download
// Accepts MB tracklist + artist/album info, searches YT for each track, queues downloads
router.post('/download/yt/album', async (req, res) => {
  const { artist, album, tracks, rgid, mbid, coverArt, year } = req.body;
  if (!artist || !album) return res.status(400).json({ error: 'Missing artist or album' });
  if (!Array.isArray(tracks) || tracks.length === 0) return res.status(400).json({ error: 'Missing tracks array' });

  try {
    const result = await ytQueueAlbum({ artist, album, tracks, rgid, mbid, coverArt, year });
    res.json({
      queued: result.queued,
      errors: result.failed,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stream audio proxy
// Accepts either normal authenticated requests or HMAC-signed URLs (for DLNA devices)
router.get('/yt/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const { sig, exp } = req.query;
  if (sig && exp) {
    if (!streamAuth.verifySignature(videoId, sig, exp)) {
      return res.status(403).json({ error: 'Invalid or expired signature' });
    }
  }
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return res.status(400).end();

  try {
    const url = await yt.getStreamUrl(videoId);

    // Proxy the audio stream
    const headers = { 'User-Agent': 'Mozilla/5.0' };
    if (req.headers.range) headers['Range'] = req.headers.range;

    const upstream = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });

    if (!upstream.ok && !upstream.status.toString().startsWith('2')) {
      return res.status(502).json({ error: `YouTube returned ${upstream.status}` });
    }

    // Forward status and relevant headers
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    // Ensure Content-Type is set so <audio> can decode — YouTube sometimes omits it
    res.setHeader('Content-Type', ct || 'audio/webm');
    const cl = upstream.headers.get('content-length');
    if (cl) res.setHeader('Content-Length', cl);
    const cr = upstream.headers.get('content-range');
    if (cr) res.setHeader('Content-Range', cr);
    const ar = upstream.headers.get('accept-ranges');
    if (ar) res.setHeader('Accept-Ranges', ar);

    // Pipe the stream with a stall timeout — if no data arrives for 15s, abort
    const reader = upstream.body.getReader();
    let stallTimer;
    const resetStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        try { reader.cancel(); } catch {}
        if (!res.writableEnded) res.end();
      }, 15000);
    };
    resetStallTimer();

    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { clearTimeout(stallTimer); res.end(); break; }
        resetStallTimer();
        if (!res.write(Buffer.from(value))) {
          await new Promise(r => res.once('drain', r));
        }
      }
    };
    pump().catch(() => { clearTimeout(stallTimer); res.end(); });

    req.on('close', () => { clearTimeout(stallTimer); try { reader.cancel(); } catch {} });
  } catch (err) {
    console.error('YT stream error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// Expose queue status for library badge derivation (called internally, not via HTTP)
function getQueueStatus() {
  return {
    active: ytQueue.filter(e => e.status === 'active').map(e => ({ artist: e.artist, album: e.album, title: e.title })),
    queued: ytQueue.filter(e => e.status === 'queued').map(e => ({ artist: e.artist, album: e.album, title: e.title })),
  };
}

module.exports = { router, ytQueueAlbum, getQueueStatus };
