const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const CONFIG_DIR = '/app/config';
const WANTED_PATH = path.join(CONFIG_DIR, 'wanted.json');

// ─── Wanted list persistence ────────────────────────────────────────────────

function loadWanted() {
  try {
    if (fs.existsSync(WANTED_PATH)) return JSON.parse(fs.readFileSync(WANTED_PATH, 'utf8'));
  } catch {}
  return [];
}

function saveWanted(list) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(WANTED_PATH, JSON.stringify(list, null, 2));
}

// ─── POST /api/import/spotify ─────────────────────────────────────────────
// Accepts a Spotify Extended Streaming History JSON (array of records)
// Extracts unique artist/album pairs from the last N days, sorted by time
router.post('/import/spotify', express.json({ limit: '50mb' }), (req, res) => {
  const { history, days = 120 } = req.body;
  if (!Array.isArray(history)) return res.status(400).json({ error: 'Expected { history: [...] } with Spotify streaming data' });

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  // Aggregate by artist+album
  const albumMap = new Map();
  for (const record of history) {
    const artist = record.master_metadata_album_artist_name;
    const album = record.master_metadata_album_album_name;
    const track = record.master_metadata_track_name;
    const ms = record.ms_played || 0;
    const ts = new Date(record.ts).getTime();

    if (!artist || !album || !track) continue;
    if (ts < cutoff) continue;
    if (ms < 30000) continue; // skip < 30s plays (skips)

    const key = `${artist.toLowerCase()}|||${album.toLowerCase()}`;
    if (!albumMap.has(key)) {
      albumMap.set(key, {
        artist,
        album,
        totalMs: 0,
        trackCount: new Set(),
        lastPlayed: record.ts,
      });
    }
    const entry = albumMap.get(key);
    entry.totalMs += ms;
    entry.trackCount.add(track.toLowerCase());
    if (record.ts > entry.lastPlayed) entry.lastPlayed = record.ts;
  }

  // Convert to sorted array
  const albums = Array.from(albumMap.values())
    .map(a => ({
      artist: a.artist,
      album: a.album,
      minutesPlayed: Math.round(a.totalMs / 60000),
      uniqueTracks: a.trackCount.size,
      lastPlayed: a.lastPlayed,
      status: 'not-searched',
    }))
    .sort((a, b) => b.minutesPlayed - a.minutesPlayed);

  // Merge with existing wanted list (don't lose status of already-searched items)
  const existing = loadWanted();
  const existingKeys = new Map(existing.map(e => [`${e.artist.toLowerCase()}|||${e.album.toLowerCase()}`, e]));

  const merged = albums.map(a => {
    const key = `${a.artist.toLowerCase()}|||${a.album.toLowerCase()}`;
    const prev = existingKeys.get(key);
    if (prev) {
      return { ...a, status: prev.status, searchResult: prev.searchResult || null };
    }
    return a;
  });

  saveWanted(merged);

  res.json({
    imported: merged.length,
    totalMinutes: merged.reduce((s, a) => s + a.minutesPlayed, 0),
    topAlbums: merged.slice(0, 20).map(a => ({ artist: a.artist, album: a.album, minutes: a.minutesPlayed })),
  });
});

// ─── GET /api/import/wanted ───────────────────────────────────────────────
// Returns the wanted list with status per album
router.get('/import/wanted', (req, res) => {
  const wanted = loadWanted();
  const { status, limit = 50, offset = 0 } = req.query;
  let filtered = wanted;
  if (status) filtered = wanted.filter(w => w.status === status);
  const total = filtered.length;
  const page = filtered.slice(Number(offset), Number(offset) + Number(limit));

  const stats = {
    total: wanted.length,
    notSearched: wanted.filter(w => w.status === 'not-searched').length,
    foundTorrent: wanted.filter(w => w.status === 'found-torrent').length,
    foundYt: wanted.filter(w => w.status === 'found-yt').length,
    inLibrary: wanted.filter(w => w.status === 'in-library').length,
    notFound: wanted.filter(w => w.status === 'not-found').length,
  };

  res.json({ stats, total, albums: page });
});

// ─── POST /api/import/wanted/:index/search ────────────────────────────────
// Triggers a search for a specific wanted album
router.post('/import/wanted/:index/search', async (req, res) => {
  const wanted = loadWanted();
  const idx = parseInt(req.params.index, 10);
  if (idx < 0 || idx >= wanted.length) return res.status(404).json({ error: 'Index out of range' });

  const item = wanted[idx];
  const query = `${item.artist} ${item.album}`;

  try {
    // Use the app's own search API internally
    const searchRes = await fetch(`http://localhost:3000/api/search?q=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(30000),
    });
    const data = await searchRes.json();

    if (data.albums && data.albums.length > 0 && data.albums[0].sources?.length > 0) {
      item.status = 'found-torrent';
      item.searchResult = {
        type: 'torrent',
        albumId: data.albums[0].id,
        quality: data.albums[0].sources[0]?.quality || '',
        seeders: data.albums[0].bestSeeders || 0,
      };
    } else if (data.mbAlbums && data.mbAlbums.length > 0) {
      item.status = 'found-yt';
      item.searchResult = {
        type: 'mb-only',
        albumId: data.mbAlbums[0].id,
        artist: data.mbAlbums[0].artist,
        album: data.mbAlbums[0].album,
      };
    } else if (data.streamingResults && data.streamingResults.length > 0) {
      item.status = 'found-yt';
      item.searchResult = { type: 'streaming', count: data.streamingResults.length };
    } else {
      item.status = 'not-found';
      item.searchResult = null;
    }

    saveWanted(wanted);
    res.json({ index: idx, artist: item.artist, album: item.album, status: item.status, searchResult: item.searchResult });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/import/wanted/batch-search ──────────────────────────────────
// Search multiple wanted albums with rate limiting
router.post('/import/wanted/batch-search', async (req, res) => {
  const { start = 0, count = 10 } = req.body;
  const wanted = loadWanted();
  const toSearch = wanted.slice(start, start + count).filter(w => w.status === 'not-searched');

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });

  let searched = 0;
  for (let i = 0; i < wanted.length && searched < toSearch.length; i++) {
    if (wanted[i].status !== 'not-searched') continue;
    if (i < start) continue;

    const item = wanted[i];
    const query = `${item.artist} ${item.album}`;

    try {
      const searchRes = await fetch(`http://localhost:3000/api/search?q=${encodeURIComponent(query)}`, {
        signal: AbortSignal.timeout(30000),
      });
      const data = await searchRes.json();

      if (data.albums?.length > 0 && data.albums[0].sources?.length > 0) {
        item.status = 'found-torrent';
        item.searchResult = { type: 'torrent', quality: data.albums[0].sources[0]?.quality || '', seeders: data.albums[0].bestSeeders || 0 };
      } else if (data.mbAlbums?.length > 0) {
        item.status = 'found-yt';
        item.searchResult = { type: 'mb-only' };
      } else {
        item.status = 'not-found';
      }
    } catch (err) {
      item.status = 'not-found';
      item.searchResult = { error: err.message };
    }

    searched++;
    res.write(`data: ${JSON.stringify({ index: i, artist: item.artist, album: item.album, status: item.status, progress: searched, total: toSearch.length })}\n\n`);

    // Rate limit: 1.5 seconds between searches to be nice to APIs
    if (searched < toSearch.length) await new Promise(r => setTimeout(r, 1500));
  }

  saveWanted(wanted);
  res.write(`data: ${JSON.stringify({ done: true, searched })}\n\n`);
  res.end();
});

// ─── POST /api/import/lastfm ──────────────────────────────────────────────
// Pull top albums from Last.fm and add to wanted list
router.post('/import/lastfm', async (req, res) => {
  const { period = '3month', limit = 50 } = req.body;

  try {
    const statusRes = await fetch('http://localhost:3000/api/lastfm/status');
    const status = await statusRes.json();
    if (!status.authenticated) return res.status(400).json({ error: 'Last.fm not authenticated' });

    const albumsRes = await fetch(`http://localhost:3000/api/lastfm/top/albums?period=${period}&limit=${limit}`);
    const topAlbums = await albumsRes.json();

    if (!Array.isArray(topAlbums) || topAlbums.length === 0) {
      return res.json({ imported: 0, message: 'No Last.fm albums found' });
    }

    const existing = loadWanted();
    const existingKeys = new Set(existing.map(e => `${e.artist.toLowerCase()}|||${e.album.toLowerCase()}`));

    let added = 0;
    for (const a of topAlbums) {
      const key = `${(a.artist || '').toLowerCase()}|||${(a.name || '').toLowerCase()}`;
      if (existingKeys.has(key)) continue;

      existing.push({
        artist: a.artist,
        album: a.name,
        minutesPlayed: 0,
        uniqueTracks: 0,
        lastPlayed: null,
        status: 'not-searched',
        source: 'lastfm',
        playcount: a.playcount || 0,
      });
      existingKeys.add(key);
      added++;
    }

    saveWanted(existing);
    res.json({ imported: added, total: existing.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/import/wanted ─────────────────────────────────────────────
// Clear the wanted list
router.delete('/import/wanted', (req, res) => {
  saveWanted([]);
  res.json({ cleared: true });
});

module.exports = router;
