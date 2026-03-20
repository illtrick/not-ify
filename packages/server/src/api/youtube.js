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

const MUSIC_DIR = process.env.MUSIC_DIR || '/app/music';

function sanitizePath(s) {
  return (s || 'Unknown').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'Unknown';
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
// YT download queue system — processes sequentially, accepts multiple requests
// ---------------------------------------------------------------------------
const ytQueue = [];       // [{id, url, title, artist, album, coverArt, status, progress, error}]
let ytQueueProcessing = false;
let ytQueueIdCounter = 0;
let activeYtDownload = null; // { abort }

function ytQueueAdd(item) {
  const entry = { id: ++ytQueueIdCounter, ...item, status: 'queued', progress: 0, error: null };
  ytQueue.push(entry);
  ytQueueProcess().catch(err => console.error('[yt-queue] Unhandled queue error:', err.message)); // kick off processing if idle
  return entry;
}

async function ytQueueProcess() {
  if (ytQueueProcessing) return;
  ytQueueProcessing = true;

  while (true) {
    const next = ytQueue.find(e => e.status === 'queued');
    if (!next) break;

    next.status = 'active';
    const abort = new AbortController();
    activeYtDownload = { abort, title: next.title };

    try {
      await ytDownloadOne(next, abort);
      next.status = 'done';
    } catch (err) {
      if (err.message === 'Download cancelled') {
        next.status = 'cancelled';
      } else {
        next.status = 'error';
        next.error = err.message;
        activity.log('youtube', 'error', `Failed: ${next.title} — ${err.message}`, { title: next.title, error: err.message });
      }
    } finally {
      activeYtDownload = null;
    }
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

  activity.log('youtube', 'info', `Downloading: ${dlTitle}`, { artist: dlArtist, album: dlAlbum, title: dlTitle });

  const destDir = path.join(MUSIC_DIR, dlArtist, dlAlbum);
  fs.mkdirSync(destDir, { recursive: true });

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
      if (line) console.error(`yt-dlp stderr: ${line}`);
    });

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      abort.signal.removeEventListener('abort', onAbort);
      if (abort.signal.aborted) return reject(new Error('Download cancelled'));
      if (code !== 0) return reject(new Error(`yt-dlp exited with code ${code}`));
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

  // Pre-warm cover art cache
  try {
    fetch(`http://localhost:3000/api/cover/search?artist=${encodeURIComponent(dlArtist)}&album=${encodeURIComponent(dlAlbum)}`, { signal: AbortSignal.timeout(10000) }).catch(() => {});
  } catch {}

  activity.log('youtube', 'success', `Saved: ${dlTitle}`, { artist: dlArtist, album: dlAlbum, title: dlTitle, path: downloadedFile });
  return downloadedFile;
}

// DELETE /api/download/yt — Cancel active yt-dlp download
router.delete('/download/yt', (req, res) => {
  if (!activeYtDownload) return res.json({ status: 'nothing_to_cancel' });
  console.log(`Cancelling yt-dlp download: ${activeYtDownload.title}`);
  activeYtDownload.abort.abort();
  // Also clear queued items
  ytQueue.forEach(e => { if (e.status === 'queued') e.status = 'cancelled'; });
  res.json({ status: 'cancelled' });
});

// GET /api/download/yt/queue — Queue status
router.get('/download/yt/queue', (req, res) => {
  const active = ytQueue.find(e => e.status === 'active') || null;
  const queued = ytQueue.filter(e => e.status === 'queued');
  const completed = ytQueue.filter(e => e.status === 'done').length;
  const errors = ytQueue.filter(e => e.status === 'error').length;
  res.json({
    active: active ? { id: active.id, title: active.title, artist: active.artist, album: active.album, progress: active.progress } : null,
    queued: queued.map(e => ({ id: e.id, title: e.title, artist: e.artist, album: e.album })),
    completed,
    errors,
    total: ytQueue.length,
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

// POST /api/download/yt/album — Album-aware YT download
// Accepts MB tracklist + artist/album info, searches YT for each track, queues downloads
router.post('/download/yt/album', async (req, res) => {
  const { artist, album, tracks, rgid, mbid, coverArt } = req.body;
  if (!artist || !album) return res.status(400).json({ error: 'Missing artist or album' });
  if (!Array.isArray(tracks) || tracks.length === 0) return res.status(400).json({ error: 'Missing tracks array' });

  const safeArtist = sanitizePath(artist);
  const safeAlbum = sanitizePath(album);

  // For each track, search YouTube and queue download
  const queued = [];
  const errors = [];

  for (const track of tracks) {
    const trackTitle = track.title || track.name;
    if (!trackTitle) continue;

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

  // Write album-level metadata
  if (queued.length > 0) {
    const destDir = path.join(MUSIC_DIR, safeArtist, safeAlbum);
    fs.mkdirSync(destDir, { recursive: true });
    const metaPath = path.join(destDir, '.metadata.json');
    const metadata = {
      artist,
      album,
      rgid: rgid || null,
      mbid: mbid || null,
      coverArt: coverArt || null,
      source: 'yt-album-download',
      trackCount: tracks.length,
      downloadedAt: new Date().toISOString(),
    };
    try {
      fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
    } catch {}
  }

  activity.log('youtube', 'info', `Album queued: ${artist} — ${album} (${queued.length} tracks, ${errors.length} failed)`, { artist, album, queued: queued.length, errors: errors.length });
  res.json({
    queued: queued.length,
    errors: errors.length,
    tracks: queued,
    failedTracks: errors,
  });
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

    // Forward status and relevant headers
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    const cl = upstream.headers.get('content-length');
    if (cl) res.setHeader('Content-Length', cl);
    const cr = upstream.headers.get('content-range');
    if (cr) res.setHeader('Content-Range', cr);
    const ar = upstream.headers.get('accept-ranges');
    if (ar) res.setHeader('Accept-Ranges', ar);

    // Pipe the stream
    const reader = upstream.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { res.end(); break; }
        if (!res.write(Buffer.from(value))) {
          await new Promise(r => res.once('drain', r));
        }
      }
    };
    pump().catch(() => res.end());

    req.on('close', () => { try { reader.cancel(); } catch {} });
  } catch (err) {
    console.error('YT stream error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

module.exports = router;
