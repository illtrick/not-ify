const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../services/db');
const streamAuth = require('../services/stream-auth');
const { log } = require('../services/activity-log');
const { generateTrackId, extractTrackNumber, titleFromFilename } = require('../services/track-id');

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
const MUSIC_DIR = db.getGlobalSetting('musicDir') || process.env.MUSIC_DIR || '/app/music';
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

function readDirMeta(dir) {
  const metaPath = path.join(dir, '.metadata.json');
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Filesystem scanner — walks MUSIC_DIR and returns raw track objects.
// Used by scanAndSync() and syncAlbum(). Does NOT touch the database.
// ---------------------------------------------------------------------------
function scanMusicDir(dir, basePath = '', inheritedMeta = null) {
  const tracks = [];
  if (!fs.existsSync(dir)) return tracks;

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

      const title = titleFromFilename(filename);
      const trackNumber = extractTrackNumber(filename);
      let fileSize = null;
      try { fileSize = fs.statSync(fullPath).size; } catch {}

      tracks.push({
        artist,
        album,
        title: title || filename,
        trackNumber,
        format: path.extname(filename).slice(1).toLowerCase(),
        filepath: fullPath,
        filename,
        fileSize,
        year: dirMeta?.year || null,
        coverArt: dirMeta?.coverArt || null,
        mbid: dirMeta?.mbid || null,
      });
    }
  }
  return tracks;
}

// ---------------------------------------------------------------------------
// Stable track IDs — assign IDs based on (artist|album|title), with
// discriminators for duplicate titles in the same album.
// ---------------------------------------------------------------------------
function assignStableIds(tracks) {
  // Group by normalized (artist|album|title) to detect duplicates
  const groups = new Map();
  for (const t of tracks) {
    const key = generateTrackId(t.artist, t.album, t.title); // base key (disc=0)
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  for (const [, group] of groups) {
    if (group.length === 1) {
      group[0].id = generateTrackId(group[0].artist, group[0].album, group[0].title, 0);
    } else {
      // Sort deterministically by filename for stable discriminator assignment
      group.sort((a, b) => a.filename.localeCompare(b.filename));
      group.forEach((t, i) => {
        t.id = generateTrackId(t.artist, t.album, t.title, i);
      });
    }
  }
  return tracks;
}

// ---------------------------------------------------------------------------
// Database-backed track map with in-memory cache.
// PIPELINE NOTE: All download paths (torrent, soulseek, youtube) call
// syncAlbum() + invalidateCache() after moving files. See job-processor.js.
// ---------------------------------------------------------------------------
let trackCache = null;

function invalidateCache() {
  trackCache = null;
}

function getTrackMap() {
  if (trackCache) return trackCache;

  let rows = db.getAllTracks();
  // Auto-scan if tracks table is empty (first startup or fresh DB)
  if (rows.length === 0 && fs.existsSync(MUSIC_DIR)) {
    scanAndSync();
    rows = db.getAllTracks();
  }
  const tracks = rows.map(r => ({
    id: r.id,
    title: r.title,
    artist: r.artist,
    album: r.album,
    year: r.year || null,
    track_number: r.track_number || null,
    coverArt: null,
    mbid: null,
    path: `/api/stream/${r.id}`,
    filename: path.basename(r.filepath),
    format: r.format,
    _fullPath: r.filepath,
  }));

  // Enrich with .metadata.json (coverArt, year, mbid) per album
  const albumDirs = new Set();
  for (const t of tracks) {
    albumDirs.add(path.dirname(t._fullPath));
  }
  const metaCache = new Map();
  for (const dir of albumDirs) {
    const meta = readDirMeta(dir);
    if (meta) metaCache.set(dir, meta);
  }
  for (const t of tracks) {
    const meta = metaCache.get(path.dirname(t._fullPath));
    if (meta) {
      t.year = meta.year || null;
      t.coverArt = meta.coverArt || null;
      t.mbid = meta.mbid || null;
    }
  }

  const map = {};
  for (const t of tracks) {
    map[t.id] = t._fullPath;
  }
  trackCache = { tracks, map };
  return trackCache;
}

// ---------------------------------------------------------------------------
// Full library scan — called on startup. Walks filesystem, upserts all tracks
// into SQLite, prunes tracks whose files no longer exist.
// ---------------------------------------------------------------------------
function scanAndSync() {
  const start = Date.now();
  const scanned = scanMusicDir(MUSIC_DIR);
  assignStableIds(scanned);

  // Upsert all scanned tracks
  for (const t of scanned) {
    db.upsertTrack({
      id: t.id,
      artist: t.artist,
      album: t.album,
      title: t.title,
      trackNumber: t.trackNumber,
      format: t.format,
      filepath: t.filepath,
      fileSize: t.fileSize,
    });
  }

  // Prune tracks that no longer exist on disk
  const validPaths = new Set(scanned.map(t => t.filepath));
  db.pruneDeletedTracks(validPaths);

  // Backfill cover_art_url from .metadata.json rgid for all album directories
  const albumDirsForBackfill = new Set();
  for (const t of scanned) {
    albumDirsForBackfill.add(path.dirname(t.filepath));
  }
  for (const dir of albumDirsForBackfill) {
    try {
      const meta = readDirMeta(dir);
      if (meta?.rgid) {
        const rel = path.relative(MUSIC_DIR, dir);
        const parts = rel.split(path.sep);
        if (parts.length >= 2) {
          const bfArtist = cleanFolderName(parts[0]) || parts[0];
          const bfAlbum = cleanFolderName(parts[1]) || parts[1];
          db.updateAlbumCoverArt(meta.artist || bfArtist, meta.album || bfAlbum, `/api/cover/rg/${meta.rgid}`);
        }
      }
    } catch { /* non-critical */ }
  }

  invalidateCache();
  const elapsed = Date.now() - start;
  console.log(`[library] Scanned ${scanned.length} tracks in ${elapsed}ms`);
  return scanned.length;
}

// ---------------------------------------------------------------------------
// Album-scoped re-scan — called by download pipeline after files are moved.
// Only re-scans the specific album directory.
// ---------------------------------------------------------------------------
function syncAlbum(artist, album) {
  const downloader = require('../services/downloader');
  const albumDir = path.join(MUSIC_DIR, downloader.sanitizePath(artist), downloader.sanitizePath(album));
  if (!fs.existsSync(albumDir)) return;

  const relBase = path.join(downloader.sanitizePath(artist), downloader.sanitizePath(album));
  const scanned = scanMusicDir(albumDir, relBase);
  assignStableIds(scanned);

  // Enrich scanned tracks with MusicBrainz metadata from .metadata.json.
  // MB data is the source of truth for track titles, positions, and album year.
  // Filename-derived titles are only used as fallback when no MB match exists.
  const meta = readDirMeta(albumDir);
  if (meta?.mbTracks && Array.isArray(meta.mbTracks)) {
    const { normalize } = require('../services/track-id');
    const mbByNormTitle = new Map();
    for (const mbt of meta.mbTracks) {
      mbByNormTitle.set(normalize(mbt.title), mbt);
    }
    for (const t of scanned) {
      const mbMatch = mbByNormTitle.get(normalize(t.title));
      if (mbMatch) {
        // Use MB title (correct capitalization, punctuation) over filename-derived
        t.title = mbMatch.title;
        if (t.trackNumber == null) t.trackNumber = mbMatch.position;
      }
    }
  }
  // Use MB artist/album name if available (correct capitalization)
  const mbArtist = meta?.artist || scanned[0]?.artist || artist;
  const mbAlbum = meta?.album || scanned[0]?.album || album;

  db.syncAlbumTracks(mbArtist, mbAlbum,
    scanned.map(t => ({
      id: t.id,
      artist: mbArtist,
      album: mbAlbum,
      title: t.title,
      trackNumber: t.trackNumber,
      format: t.format,
      filepath: t.filepath,
      fileSize: t.fileSize,
      year: t.year || meta?.year || null,
    }))
  );

  // Backfill rgid and cover_art_url from .metadata.json into albums table
  if (meta?.rgid) {
    try {
      db.updateAlbumCoverArt(mbArtist, mbAlbum, `/api/cover/rg/${meta.rgid}`);
    } catch { /* non-critical */ }
  }

  invalidateCache();
}

// GET /api/library
router.get('/library', (req, res) => {
  try {
    // -------------------------------------------------------------------
    // New schema: album-grouped with nested tracks from three-table schema
    // -------------------------------------------------------------------
    const albumsData = db.getAllAlbumsWithTracks();

    // Build active job/queue state for badge derivation
    // This makes badges reflect real-time system state, not just static DB rows
    const activeAlbumJobs = new Map(); // key: 'artist|album' → job type
    try {
      const jobQueue = require('../services/job-queue');
      const activeJobs = [...jobQueue.getByStatus('active'), ...jobQueue.getByStatus('pending')];
      for (const job of activeJobs) {
        const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
        if (payload?.artist && payload?.album) {
          const key = (payload.artist + '|' + payload.album).toLowerCase();
          // upgrade > download > soulseek-download in priority
          if (!activeAlbumJobs.has(key) || job.type === 'upgrade') {
            activeAlbumJobs.set(key, job.type);
          }
        }
      }
    } catch {}

    const activeYtAlbums = new Set(); // albums with active YT downloads
    try {
      const yt = require('./youtube');
      const ytStatus = yt.getQueueStatus?.();
      if (ytStatus?.active?.length || ytStatus?.queued?.length) {
        for (const item of [...(ytStatus.active || []), ...(ytStatus.queued || [])]) {
          if (item.artist && item.album) {
            activeYtAlbums.add((item.artist + '|' + item.album).toLowerCase());
          }
        }
      }
    } catch {}

    // Transform to client-friendly format
    const albums = albumsData.map(a => {
      const albumKey = (a.album_artist + '|' + a.title).toLowerCase();
      const activeJobType = activeAlbumJobs.get(albumKey);
      const hasActiveYt = activeYtAlbums.has(albumKey);

      return {
        albumId: a.id,
        artist: a.album_artist,
        album: a.title,
        year: a.year,
        trackCount: a.track_count,
        duration: a.duration,
        coverArt: a.cover_art_url,
        mbid: a.mbid,
        rgid: a.rgid,
        compilation: !!a.compilation,
        tracks: (a.tracks || []).map(t => {
          // Derive fileStatus from system state
          let fileStatus = null;
          if (t.file) {
            if (activeJobType === 'upgrade' || activeJobType === 'download' || activeJobType === 'soulseek-download') {
              fileStatus = 'upgrading'; // has file + active upgrade = show format↑
            } else {
              fileStatus = 'available';
            }
          } else if (hasActiveYt || activeJobType) {
            fileStatus = 'processing'; // no file + active download = processing
          }

          return {
            id: t.id,
            title: t.title,
            artist: t.artist,
            trackNumber: t.track_number,
            discNumber: t.disc_number,
            duration: t.duration,
            mbid: t.mbid,
            // File state (null if not downloaded)
            format: t.file?.format || null,
            filepath: t.file?.filepath || null,
            fileSize: t.file?.file_size || null,
            scanStatus: t.file?.scan_status || null,
            fileStatus,
          };
        }),
      };
    });

    // Also generate flat track array for backward compatibility
    // This keeps existing client code working during transition
    const flatTracks = [];
    for (const album of albumsData) {
      for (const t of (album.tracks || [])) {
        if (t.file) {
          flatTracks.push({
            id: t.id,
            title: t.title,
            artist: t.artist,
            album: album.title,
            year: album.year ? String(album.year) : null,
            track_number: t.track_number,
            coverArt: album.cover_art_url,
            mbid: album.mbid,
            path: `/api/stream/${t.id}`,
            format: t.file.format,
            filepath: t.file.filepath,
            _fullPath: t.file.filepath,
          });
        }
      }
    }

    // Append excluded tracks from .metadata.json so the UI can render them greyed out
    const excludedEntries = [];
    const seenDirs = new Set();
    for (const t of flatTracks) {
      if (t._fullPath) seenDirs.add(path.dirname(t._fullPath));
    }
    for (const dir of seenDirs) {
      const meta = readDirMeta(dir);
      if (!meta || !Array.isArray(meta.excluded) || meta.excluded.length === 0) continue;
      const rel = path.relative(MUSIC_DIR, dir);
      const parts = rel.split(path.sep);
      const artist = parts.length >= 2 ? (cleanFolderName(parts[0]) || parts[0]) : 'Unknown Artist';
      const albumName = parts.length >= 2 ? (cleanFolderName(parts[1]) || parts[1]) : (cleanFolderName(parts[0]) || parts[0]);
      for (const excludedName of meta.excluded) {
        excludedEntries.push({
          id: `excluded-${excludedName}`,
          title: excludedName.replace(/^\d+[-_ ]*/, '').replace(/\.\w+$/, ''),
          artist,
          album: albumName,
          format: null,
          excluded: true,
        });
      }
    }

    // Strip _fullPath from flat tracks before sending
    const cleaned = flatTracks.map(({ _fullPath, ...rest }) => rest);

    // Return both formats
    res.json({
      albums,                                     // New: album-grouped with all tracks (even undownloaded)
      tracks: [...cleaned, ...excludedEntries],   // Legacy: flat array of downloaded tracks + excluded
    });
  } catch (err) {
    // Fallback to old getTrackMap if new schema fails
    console.warn('[library] New schema read failed, falling back:', err.message);
    try {
      const { tracks } = getTrackMap();
      const cleaned = tracks.map(({ _fullPath, ...rest }) => rest);

      // Append excluded tracks from .metadata.json
      const albumDirs = new Set();
      for (const t of tracks) {
        albumDirs.add(path.dirname(t._fullPath));
      }
      const excludedEntries = [];
      for (const dir of albumDirs) {
        const meta = readDirMeta(dir);
        if (!meta || !Array.isArray(meta.excluded) || meta.excluded.length === 0) continue;
        const rel = path.relative(MUSIC_DIR, dir);
        const parts = rel.split(path.sep);
        const artist = parts.length >= 2 ? (cleanFolderName(parts[0]) || parts[0]) : 'Unknown Artist';
        const album = parts.length >= 2 ? (cleanFolderName(parts[1]) || parts[1]) : (cleanFolderName(parts[0]) || parts[0]);
        for (const excludedName of meta.excluded) {
          excludedEntries.push({
            id: `excluded-${excludedName}`,
            title: excludedName.replace(/^\d+[-_ ]*/, '').replace(/\.\w+$/, ''),
            artist,
            album,
            format: null,
            excluded: true,
          });
        }
      }

      res.json([...cleaned, ...excludedEntries]);
    } catch (fallbackErr) {
      console.error('[library] Fallback also failed:', fallbackErr.message);
      res.json([]);
    }
  }
});

// GET /api/album/:id — canonical album detail endpoint
// Resolves by album PK, rgid, or mbid. Returns album metadata + tracks with file status.
router.get('/album/:id', (req, res) => {
  try {
    const resolved = db.getAlbumByAnyId(req.params.id);
    if (!resolved) return res.status(404).json({ error: 'not_found' });

    const albumData = db.getAlbumWithTracks(resolved.id);
    if (!albumData) return res.status(404).json({ error: 'not_found' });

    const tracks = (albumData.tracks || []).map(t => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      trackNumber: t.track_number,
      discNumber: t.disc_number || 1,
      duration: t.duration,
      mbid: t.mbid || null,
      file: t.file ? {
        format: t.file.format,
        bitrate: t.file.bitrate || null,
        fileSize: t.file.file_size || null,
        filepath: t.file.filepath,
      } : null,
    }));

    res.json({
      id: albumData.id,
      artist: albumData.album_artist,
      album: albumData.title,
      year: albumData.year || null,
      rgid: albumData.rgid || null,
      mbid: albumData.mbid || null,
      coverArt: albumData.cover_art_url || (albumData.rgid ? `/api/cover/rg/${albumData.rgid}` : null),
      trackCount: tracks.length,
      duration: tracks.reduce((s, t) => s + (t.duration || 0), 0),
      inLibrary: tracks.some(t => t.file !== null),
      compilation: !!albumData.compilation,
      tracks,
    });
  } catch (err) {
    console.error('[album] Error fetching album:', err.message);
    res.status(500).json({ error: 'internal' });
  }
});

// GET /api/stream/:id — serve audio with range request support
// Accepts either normal authenticated requests or HMAC-signed URLs (for DLNA devices)
router.get('/stream/:id', (req, res) => {
  const streamStart = Date.now();

  const { sig, exp } = req.query;
  if (sig && exp) {
    if (!streamAuth.verifySignature(req.params.id, sig, exp)) {
      return res.status(403).json({ error: 'Invalid or expired signature' });
    }
  }

  // Look up filepath from DB (fast), fall back to new schema, then cached map
  let track = db.getTrackById(req.params.id);
  if (!track && typeof db.getTrackFilepath === 'function') {
    // Fallback to new three-table schema
    try {
      const newFilepath = db.getTrackFilepath(req.params.id);
      if (newFilepath) {
        track = { id: req.params.id, filepath: newFilepath };
      }
    } catch (e) {
      // New schema not available, continue to cached map fallback
    }
  }
  const filePath = track?.filepath || getTrackMap().map[req.params.id];

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

  res.on('finish', () => {
    log('player', 'debug', 'stream_served', {
      traceId: req.headers['x-trace-id'],
      trackId: req.params.id,
      bytes: res.getHeader('content-length'),
      latencyMs: Date.now() - streamStart,
    });
  });
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
        db.removeTrackByFilepath(dupes[i]._fullPath);
        removed++;
        console.log(`[dedupe] Removed: ${dupes[i]._fullPath} (kept ${dupes[0].format}, removed ${dupes[i].format})`);
      } catch (err) {
        console.warn(`[dedupe] Failed to remove ${dupes[i]._fullPath}: ${err.message}`);
      }
    }
  }

  invalidateCache();
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
      const fp = path.join(albumDir, f);
      fs.unlinkSync(fp);
      db.removeTrackByFilepath(fp);
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

  invalidateCache();
  console.log(`[library] Removed album: ${artist}/${album} (${removed} files)`);
  res.json({ removed, artist, album });
});

// DELETE /api/library/track/:id — Remove a single track
router.delete('/library/track/:id', (req, res) => {
  const track = db.getTrackById(req.params.id);
  const filePath = track?.filepath || getTrackMap().map[req.params.id];
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Track not found' });
  }

  const filename = path.basename(filePath);
  const dir = path.dirname(filePath);

  try {
    fs.unlinkSync(filePath);

    // Add to excluded list in .metadata.json so the upgrader doesn't re-add it
    const metaPath = path.join(dir, '.metadata.json');
    let meta = {};
    try {
      if (fs.existsSync(metaPath)) meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch { /* start fresh */ }
    if (!Array.isArray(meta.excluded)) meta.excluded = [];
    if (!meta.excluded.includes(filename)) meta.excluded.push(filename);
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    // Clean up empty directories (no audio files left)
    const remaining = fs.readdirSync(dir).filter(f => f !== '.metadata.json');
    if (remaining.length === 0) {
      if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
      fs.rmdirSync(dir);
      const parentDir = path.dirname(dir);
      if (parentDir !== MUSIC_DIR && fs.existsSync(parentDir) && fs.readdirSync(parentDir).length === 0) {
        fs.rmdirSync(parentDir);
      }
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  db.removeTrackById(req.params.id);
  invalidateCache();
  console.log(`[library] Removed track: ${filePath} (excluded: ${filename})`);
  res.json({ removed: 1, id: req.params.id, excluded: filename });
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

// DELETE /api/library/track/exclude — Restore a previously excluded track
// Query params: artist, album, filename
router.delete('/library/track/exclude', (req, res) => {
  const { artist, album, filename } = req.query;
  if (!artist || !album || !filename) {
    return res.status(400).json({ error: 'Missing artist, album, or filename' });
  }

  const downloader = require('../services/downloader');
  const albumDir = path.join(MUSIC_DIR, downloader.sanitizePath(artist), downloader.sanitizePath(album));
  const metaPath = path.join(albumDir, '.metadata.json');

  if (!fs.existsSync(metaPath)) {
    return res.status(404).json({ error: 'No metadata found for this album' });
  }

  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    return res.status(500).json({ error: 'Failed to read metadata' });
  }

  if (!Array.isArray(meta.excluded)) {
    return res.status(404).json({ error: 'Track not in excluded list' });
  }

  const idx = meta.excluded.indexOf(filename);
  if (idx === -1) {
    return res.status(404).json({ error: 'Track not in excluded list' });
  }

  meta.excluded.splice(idx, 1);
  if (meta.excluded.length === 0) delete meta.excluded;

  try {
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  invalidateCache();
  console.log(`[library] Restored excluded track: ${filename} in ${artist}/${album}`);
  res.json({ restored: 1, filename, artist, album });
});

// POST /api/library/rescan — admin-triggered full re-scan
router.post('/library/rescan', (req, res) => {
  const count = scanAndSync();
  res.json({ scanned: count });
});

module.exports = router;

// Expose for download pipelines and unit testing
module.exports.getTrackMap = getTrackMap;
module.exports.syncAlbum = syncAlbum;
module.exports.scanAndSync = scanAndSync;
module.exports.invalidateCache = invalidateCache;
module.exports.MIME_TYPES = MIME_TYPES;
module.exports._test = { cleanFolderName, scanMusicDir, QUALITY_RANK, assignStableIds };
