const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../services/db');
const streamAuth = require('../services/stream-auth');

// Clean folder-derived names: decode HTML entities and strip torrent artifacts
function cleanFolderName(s) {
  if (!s) return s;
  return s
    .replace(/&amp;/gi, '&').replace(/&rsquo;/gi, "'").replace(/&lsquo;/gi, "'")
    .replace(/&rdquo;/gi, '"').replace(/&ldquo;/gi, '"').replace(/&hellip;/gi, '...')
    .replace(/&ndash;/gi, '-').replace(/&mdash;/gi, '-')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCharCode(parseInt(n, 10)); } catch { return ''; } })
    .replace(/\b(\d*kbps?|FLAC|MP3|320|V0|V2|Lossless|24bit|24-bit|AAC|OGG|OPUS|WAV|WEB)\b/gi, '')
    .replace(/\s+\d{1,3}$/, '')
    .replace(/^[\s\-–—·_]+|[\s\-–—·_]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim() || s;
}

const router = express.Router();
const MUSIC_DIR = process.env.MUSIC_DIR || '/app/music';
const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.ogg', '.m4a', '.aac', '.wav', '.opus']);

// ---------------------------------------------------------------------------
// Recently Played — per-user SSE broadcast via SQLite
// ---------------------------------------------------------------------------
// Map of userId -> Set<res> for per-user SSE
const sseClients = new Map();

function broadcastRecentlyPlayed(userId, list) {
  const clients = sseClients.get(userId);
  if (!clients || clients.size === 0) return;
  const msg = `data: ${JSON.stringify(list)}\n\n`;
  for (const client of clients) {
    try { client.write(msg); } catch { clients.delete(client); }
  }
}

const MIME_TYPES = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.opus': 'audio/opus',
};

function fileId(filepath) {
  return crypto.createHash('md5').update(filepath).digest('hex');
}

function readDirMeta(dir) {
  const metaPath = path.join(dir, '.metadata.json');
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    return null;
  }
}

function scanMusicDir(dir, basePath = '', inheritedMeta = null) {
  const tracks = [];
  if (!fs.existsSync(dir)) return tracks;

  // Pick up .metadata.json if present at this level
  const dirMeta = readDirMeta(dir) || inheritedMeta;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.join(basePath, entry.name);

    if (entry.isDirectory()) {
      tracks.push(...scanMusicDir(fullPath, relPath, dirMeta));
    } else if (AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      const parts = relPath.split(path.sep);
      let artist = 'Unknown Artist';
      let album = 'Unknown Album';
      const filename = entry.name;

      if (parts.length >= 3) {
        artist = cleanFolderName(parts[0]) || parts[0];
        album = cleanFolderName(parts[1]) || parts[1];
      } else if (parts.length === 2) {
        artist = cleanFolderName(parts[0]) || parts[0];
      }

      // Derive title from filename: strip track number prefix and extension
      const title = path.basename(filename, path.extname(filename))
        .replace(/^\d+[\s._-]+/, '');

      const id = fileId(fullPath);
      tracks.push({
        id,
        title: title || filename,
        artist,
        album,
        year: dirMeta?.year || null,
        coverArt: dirMeta?.coverArt || null,
        mbid: dirMeta?.mbid || null,
        path: `/api/stream/${id}`,
        filename,
        format: path.extname(filename).slice(1).toLowerCase(),
        _fullPath: fullPath,
      });
    }
  }
  return tracks;
}

// Build an id→path lookup
let trackCache = null;
function getTrackMap() {
  const tracks = scanMusicDir(MUSIC_DIR);
  const map = {};
  for (const t of tracks) {
    map[t.id] = t._fullPath;
  }
  trackCache = { tracks, map };
  return trackCache;
}

// GET /api/library
router.get('/library', (req, res) => {
  const { tracks } = getTrackMap();
  // Remove internal _fullPath from response
  const cleaned = tracks.map(({ _fullPath, ...rest }) => rest);
  res.json(cleaned);
});

// GET /api/stream/:id — serve audio with range request support
// Accepts either normal authenticated requests or HMAC-signed URLs (for DLNA devices)
router.get('/stream/:id', (req, res) => {
  const { sig, exp } = req.query;
  if (sig && exp) {
    if (!streamAuth.verifySignature(req.params.id, sig, exp)) {
      return res.status(403).json({ error: 'Invalid or expired signature' });
    }
  }

  const { map } = getTrackMap();
  const filePath = map[req.params.id];

  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Track not found' });
  }

  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// POST /api/library/dedupe — Remove duplicate tracks, keep highest quality
const QUALITY_RANK = { flac: 5, wav: 4, m4a: 3, aac: 2, opus: 2, ogg: 2, mp3: 1 };

router.post('/library/dedupe', (req, res) => {
  const { tracks } = getTrackMap();

  // Group by normalized artist+album+title
  const groups = {};
  for (const t of tracks) {
    const key = `${t.artist}::${t.album}::${t.title}`.toLowerCase().replace(/[^a-z0-9:]/g, '');
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  }

  let removed = 0;
  for (const [key, dupes] of Object.entries(groups)) {
    if (dupes.length <= 1) continue;

    // Sort: highest quality first, then largest file as tiebreaker
    dupes.sort((a, b) => {
      const qa = QUALITY_RANK[a.format] || 0;
      const qb = QUALITY_RANK[b.format] || 0;
      if (qb !== qa) return qb - qa;
      // Tiebreaker: file size (larger = better)
      try {
        const sizeA = fs.statSync(a._fullPath).size;
        const sizeB = fs.statSync(b._fullPath).size;
        return sizeB - sizeA;
      } catch { return 0; }
    });

    // Keep first (best), delete rest
    for (let i = 1; i < dupes.length; i++) {
      try {
        fs.unlinkSync(dupes[i]._fullPath);
        removed++;
        console.log(`[dedupe] Removed: ${dupes[i]._fullPath} (kept ${dupes[0].format}, removed ${dupes[i].format})`);
      } catch (err) {
        console.warn(`[dedupe] Failed to remove ${dupes[i]._fullPath}: ${err.message}`);
      }
    }
  }

  res.json({ removed, scanned: tracks.length });
});

// DELETE /api/library/album — Remove an album folder from library
router.delete('/library/album', (req, res) => {
  const { artist, album } = req.body;
  if (!artist || !album) return res.status(400).json({ error: 'Missing artist or album' });

  const albumDir = path.join(MUSIC_DIR, artist, album);
  if (!fs.existsSync(albumDir)) {
    return res.status(404).json({ error: 'Album not found' });
  }

  // Remove all files in the album directory
  let removed = 0;
  try {
    const files = fs.readdirSync(albumDir);
    for (const f of files) {
      fs.unlinkSync(path.join(albumDir, f));
      removed++;
    }
    fs.rmdirSync(albumDir);
    // Clean up empty artist directory
    const artistDir = path.join(MUSIC_DIR, artist);
    if (fs.existsSync(artistDir) && fs.readdirSync(artistDir).length === 0) {
      fs.rmdirSync(artistDir);
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  console.log(`[library] Removed album: ${artist}/${album} (${removed} files)`);
  res.json({ removed, artist, album });
});

// DELETE /api/library/track/:id — Remove a single track
router.delete('/library/track/:id', (req, res) => {
  const { map } = getTrackMap();
  const filePath = map[req.params.id];
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Track not found' });
  }

  try {
    fs.unlinkSync(filePath);
    // Clean up empty directories
    const dir = path.dirname(filePath);
    const remaining = fs.readdirSync(dir).filter(f => f !== '.metadata.json');
    if (remaining.length === 0) {
      // Remove metadata and directory
      const metaPath = path.join(dir, '.metadata.json');
      if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
      fs.rmdirSync(dir);
      // Clean up empty parent
      const parentDir = path.dirname(dir);
      if (parentDir !== MUSIC_DIR && fs.existsSync(parentDir) && fs.readdirSync(parentDir).length === 0) {
        fs.rmdirSync(parentDir);
      }
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  console.log(`[library] Removed track: ${filePath}`);
  res.json({ removed: 1, id: req.params.id });
});

// ---------------------------------------------------------------------------
// Recently Played endpoints
// ---------------------------------------------------------------------------

// SSE stream — per-user, keeps connection open, pushes updates
router.get('/recently-played/stream', (req, res) => {
  const userId = req.userId;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  // Send current list immediately
  res.write(`data: ${JSON.stringify(db.getRecentlyPlayed(userId))}\n\n`);
  if (!sseClients.has(userId)) sseClients.set(userId, new Set());
  sseClients.get(userId).add(res);
  const totalClients = Array.from(sseClients.values()).reduce((sum, s) => sum + s.size, 0);
  console.log(`[recently-played] SSE client connected for ${userId} (${totalClients} total)`);
  req.on('close', () => {
    const clients = sseClients.get(userId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) sseClients.delete(userId);
    }
    const remaining = Array.from(sseClients.values()).reduce((sum, s) => sum + s.size, 0);
    console.log(`[recently-played] SSE client disconnected (${remaining} remaining)`);
  });
});

// Simple GET fallback
router.get('/recently-played', (req, res) => {
  res.json(db.getRecentlyPlayed(req.userId));
});

// POST — report a single play event
router.post('/recently-played', express.json(), (req, res) => {
  const { artist, album, coverArt, mbid, rgid } = req.body;
  if (!artist || !album) return res.status(400).json({ error: 'Missing artist or album' });
  const list = db.addRecentlyPlayed(req.userId, { artist, album, coverArt, mbid, rgid });
  broadcastRecentlyPlayed(req.userId, list);
  res.json(list);
});

// PUT — bulk replace (one-time migration from localStorage)
router.put('/recently-played', express.json(), (req, res) => {
  const list = req.body;
  if (!Array.isArray(list)) return res.status(400).json({ error: 'Expected array' });
  const cleaned = list.filter(r => r.artist && r.album);
  const result = db.bulkSetRecentlyPlayed(req.userId, cleaned);
  broadcastRecentlyPlayed(req.userId, result);
  res.json(result);
});

module.exports = router;

// Expose pure functions for unit testing
module.exports._test = { cleanFolderName, fileId, scanMusicDir, QUALITY_RANK };
