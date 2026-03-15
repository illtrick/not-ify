const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const rd = require('./services/realdebrid');
const searchRouter = require('./api/search');
const pipelineRouter = require('./api/pipeline');
const libraryRouter = require('./api/library');

const app = express();
const PORT = 3000;
const COVERS_DIR = '/app/config/covers';

app.use(cors());
app.use(express.json());

// Serve static client build
app.use(express.static(path.join(__dirname, '../../client/dist')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'notify-server' });
});

// Test RD token
app.get('/api/test/rd-status', async (req, res) => {
  try {
    const user = await rd.getUserInfo();
    res.json({ status: 'ok', user: { username: user.username, email: user.email, type: user.type, premium: user.premium, expiration: user.expiration } });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Shared cover art fetch helper
async function fetchAndCacheCover(coverUrl, cachePath, missPath, res) {
  fs.mkdirSync(COVERS_DIR, { recursive: true });

  if (fs.existsSync(cachePath)) {
    return res.setHeader('Cache-Control', 'public, max-age=31536000').setHeader('Content-Type', 'image/jpeg').sendFile(cachePath);
  }
  if (fs.existsSync(missPath)) return res.status(404).end();

  try {
    const coverRes = await fetch(coverUrl, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Notify/0.1.0 (personal-use)' },
    });
    if (!coverRes.ok) {
      fs.writeFileSync(missPath, '');
      return res.status(404).end();
    }
    const buf = Buffer.from(await coverRes.arrayBuffer());
    fs.writeFileSync(cachePath, buf);
    res.setHeader('Cache-Control', 'public, max-age=31536000').setHeader('Content-Type', 'image/jpeg').send(buf);
  } catch (err) {
    console.error(`Cover art fetch failed: ${err.message}`);
    res.status(404).end();
  }
}

// Album art fallback search (iTunes → Deezer) — must be before parameterized routes
app.get('/api/cover/search', async (req, res) => {
  const { artist, album } = req.query;
  if (!artist || !album) return res.status(400).json({ error: 'Missing artist and album params' });

  const key = 'search-' + crypto.createHash('md5').update((artist + album).toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');
  const cachePath = path.join(COVERS_DIR, key + '.jpg');
  const missPath = path.join(COVERS_DIR, key + '.miss');

  fs.mkdirSync(COVERS_DIR, { recursive: true });

  if (fs.existsSync(cachePath)) {
    return res.setHeader('Cache-Control', 'public, max-age=31536000').setHeader('Content-Type', 'image/jpeg').sendFile(cachePath);
  }
  if (fs.existsSync(missPath)) return res.status(404).end();

  // Try iTunes
  try {
    const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(artist + ' ' + album)}&entity=album&limit=1`, { signal: AbortSignal.timeout(3000) });
    if (itunesRes.ok) {
      const itunesData = await itunesRes.json();
      const artUrl = itunesData.results?.[0]?.artworkUrl100;
      if (artUrl) {
        const hiRes = artUrl.replace('100x100bb', '600x600bb');
        const imgRes = await fetch(hiRes, { signal: AbortSignal.timeout(3000) });
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          fs.writeFileSync(cachePath, buf);
          return res.setHeader('Cache-Control', 'public, max-age=31536000').setHeader('Content-Type', 'image/jpeg').send(buf);
        }
      }
    }
  } catch (err) {
    console.error(`iTunes cover search failed: ${err.message}`);
  }

  // Try Deezer
  try {
    const deezerRes = await fetch(`https://api.deezer.com/search/album?q=artist:"${artist}" album:"${album}"&limit=1`, { signal: AbortSignal.timeout(3000) });
    if (deezerRes.ok) {
      const deezerData = await deezerRes.json();
      const coverUrl = deezerData.data?.[0]?.cover_big;
      if (coverUrl) {
        const imgRes = await fetch(coverUrl, { signal: AbortSignal.timeout(3000) });
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          fs.writeFileSync(cachePath, buf);
          return res.setHeader('Cache-Control', 'public, max-age=31536000').setHeader('Content-Type', 'image/jpeg').send(buf);
        }
      }
    }
  } catch (err) {
    console.error(`Deezer cover search failed: ${err.message}`);
  }

  // All failed
  fs.writeFileSync(missPath, '');
  res.status(404).end();
});

// Artist image via Deezer API (proxy to avoid CORS, with caching)
app.get('/api/artist/image', async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'Missing name param' });

  const key = 'artist-' + crypto.createHash('md5').update(name.toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');
  const cachePath = path.join(COVERS_DIR, key + '.jpg');
  const missPath = path.join(COVERS_DIR, key + '.miss');

  fs.mkdirSync(COVERS_DIR, { recursive: true });

  if (fs.existsSync(cachePath)) {
    return res.setHeader('Cache-Control', 'public, max-age=31536000').setHeader('Content-Type', 'image/jpeg').sendFile(cachePath);
  }
  if (fs.existsSync(missPath)) return res.status(404).end();

  try {
    const deezerRes = await fetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=1`, { signal: AbortSignal.timeout(5000) });
    if (deezerRes.ok) {
      const data = await deezerRes.json();
      const imgUrl = data.data?.[0]?.picture_big || data.data?.[0]?.picture_medium;
      if (imgUrl) {
        const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(5000) });
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          fs.writeFileSync(cachePath, buf);
          return res.setHeader('Cache-Control', 'public, max-age=31536000').setHeader('Content-Type', 'image/jpeg').send(buf);
        }
      }
    }
  } catch (err) {
    console.error(`Artist image fetch failed: ${err.message}`);
  }

  fs.writeFileSync(missPath, '');
  res.status(404).end();
});

// Color extraction for search-based cover art
app.get('/api/cover/search/color', (req, res) => {
  const { artist, album } = req.query;
  if (!artist || !album) return res.status(400).json({ error: 'Missing artist and album params' });

  const key = 'search-' + crypto.createHash('md5').update((artist + album).toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');
  const cachePath = path.join(COVERS_DIR, key + '.jpg');
  extractColor(cachePath, key, res);
});

// Cover art by release MBID
app.get('/api/cover/:mbid', async (req, res) => {
  const { mbid } = req.params;
  if (!/^[0-9a-f-]{36}$/.test(mbid)) return res.status(400).end();
  const cachePath = path.join(COVERS_DIR, `${mbid}.jpg`);
  const missPath = path.join(COVERS_DIR, `${mbid}.miss`);
  await fetchAndCacheCover(`https://coverartarchive.org/release/${mbid}/front-250`, cachePath, missPath, res);
});

// Cover art by release-group ID — falls back to per-release mbid if provided as ?mbid=
app.get('/api/cover/rg/:rgid', async (req, res) => {
  const { rgid } = req.params;
  const { mbid } = req.query;
  if (!/^[0-9a-f-]{36}$/.test(rgid)) return res.status(400).end();

  fs.mkdirSync(COVERS_DIR, { recursive: true });
  const cachePath = path.join(COVERS_DIR, `rg-${rgid}.jpg`);
  const missPath = path.join(COVERS_DIR, `rg-${rgid}.miss`);

  // Serve from cache if we already have it
  if (fs.existsSync(cachePath)) {
    return res.setHeader('Cache-Control', 'public, max-age=31536000').setHeader('Content-Type', 'image/jpeg').sendFile(cachePath);
  }

  // If no rg miss yet, try CAA release-group
  if (!fs.existsSync(missPath)) {
    try {
      const coverRes = await fetch(`https://coverartarchive.org/release-group/${rgid}/front-250`, {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'Notify/0.1.0 (personal-use)' },
      });
      if (coverRes.ok) {
        const buf = Buffer.from(await coverRes.arrayBuffer());
        fs.writeFileSync(cachePath, buf);
        return res.setHeader('Cache-Control', 'public, max-age=31536000').setHeader('Content-Type', 'image/jpeg').send(buf);
      }
      fs.writeFileSync(missPath, '');
    } catch (err) {
      console.error(`Cover art fetch failed (rg): ${err.message}`);
      fs.writeFileSync(missPath, '');
    }
  }

  // Fall back to per-release mbid if available
  if (mbid && /^[0-9a-f-]{36}$/.test(mbid)) {
    const mbCachePath = path.join(COVERS_DIR, `${mbid}.jpg`);
    const mbMissPath = path.join(COVERS_DIR, `${mbid}.miss`);
    if (fs.existsSync(mbCachePath)) {
      return res.setHeader('Cache-Control', 'public, max-age=31536000').setHeader('Content-Type', 'image/jpeg').sendFile(mbCachePath);
    }
    if (!fs.existsSync(mbMissPath)) {
      try {
        const coverRes = await fetch(`https://coverartarchive.org/release/${mbid}/front-250`, {
          signal: AbortSignal.timeout(8000),
          headers: { 'User-Agent': 'Notify/0.1.0 (personal-use)' },
        });
        if (coverRes.ok) {
          const buf = Buffer.from(await coverRes.arrayBuffer());
          fs.writeFileSync(mbCachePath, buf);
          return res.setHeader('Cache-Control', 'public, max-age=31536000').setHeader('Content-Type', 'image/jpeg').send(buf);
        }
        fs.writeFileSync(mbMissPath, '');
      } catch (err) {
        console.error(`Cover art fetch failed (mbid): ${err.message}`);
        fs.writeFileSync(mbMissPath, '');
      }
    }
  }

  res.status(404).end();
});

// Color extraction from cover art (for gradient headers)
const sharp = require('sharp');
const colorCache = new Map();

async function extractColor(cachePath, cacheKey, res) {
  if (colorCache.has(cacheKey)) return res.json({ color: colorCache.get(cacheKey) });
  if (!fs.existsSync(cachePath)) return res.json({ color: null });
  try {
    const { data } = await sharp(cachePath).resize(1, 1).raw().toBuffer({ resolveWithObject: true });
    const color = [data[0], data[1], data[2]];
    colorCache.set(cacheKey, color);
    res.json({ color });
  } catch {
    res.json({ color: null });
  }
}

app.get('/api/cover/:mbid/color', (req, res) => {
  const { mbid } = req.params;
  if (!/^[0-9a-f-]{36}$/.test(mbid)) return res.status(400).end();
  extractColor(path.join(COVERS_DIR, `${mbid}.jpg`), mbid, res);
});

app.get('/api/cover/rg/:rgid/color', (req, res) => {
  const { rgid } = req.params;
  if (!/^[0-9a-f-]{36}$/.test(rgid)) return res.status(400).end();
  extractColor(path.join(COVERS_DIR, `rg-${rgid}.jpg`), `rg-${rgid}`, res);
});

// LLM health check
const llm = require('./services/llm');
app.get('/api/llm/health', async (req, res) => {
  const ok = await llm.checkHealth();
  res.json({ status: ok ? 'ok' : 'unavailable' });
});

// Search (unified: torrents + MusicBrainz metadata)
app.use('/api', searchRouter);

// Pipeline (download) routes
app.use('/api', pipelineRouter);

// Library and streaming routes
app.use('/api', libraryRouter);

// YouTube search and streaming routes
const youtubeRouter = require('./api/youtube');
app.use('/api', youtubeRouter);

// Last.fm integration
const lastfmRouter = require('./api/lastfm');
app.use('/api', lastfmRouter);

// SPA fallback — serve index.html for non-API routes
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, '../../client/dist/index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Client not built yet. Run: cd client && npm run build' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Notify server running on port ${PORT}`);
});
