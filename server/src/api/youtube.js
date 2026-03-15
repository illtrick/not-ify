const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = express.Router();
const yt = require('../services/youtube');

const MUSIC_DIR = '/app/music';

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
  ytQueueProcess(); // kick off processing if idle
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
        console.error(`yt-dlp queue error (${next.title}): ${err.message}`);
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

  console.log(`[yt-queue] Downloading: ${dlTitle} → ${dlArtist}/${dlAlbum}`);

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
    const proc = spawn('yt-dlp', args, { timeout: 120000 });
    let lastFile = '';

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
      abort.signal.removeEventListener('abort', onAbort);
      reject(err);
    });
  });

  entry.progress = 100;

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

  console.log(`[yt-queue] Done: ${dlTitle}`);
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

// Stream audio proxy
router.get('/yt/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  console.log(`[YT stream] Request for ${videoId}, range: ${req.headers.range || 'none'}`);
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
