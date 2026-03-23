// Load .env.dev for native Windows development (no Docker)
const _envPath = require('path').resolve(__dirname, '../../../.env.dev');
if (require('fs').existsSync(_envPath)) {
  for (const line of require('fs').readFileSync(_envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const rd = require('./services/realdebrid');
const db = require('./services/db');
const { migrate } = require('./services/migrate');
const userMiddleware = require('./middleware/user');
const adminGuard = require('./middleware/admin');
const searchRouter = require('./api/search');
const pipelineRouter = require('./api/pipeline');
const libraryRouter = require('./api/library');
const upgradeRouter = require('./api/upgrade');

const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_DIR = process.env.CONFIG_DIR || '/app/config';
const MUSIC_DIR = db.getGlobalSetting('musicDir') || process.env.MUSIC_DIR || '/app/music';
const COVERS_DIR = path.join(CONFIG_DIR, 'covers');

app.use(cors());
app.use(express.json());

// User identification middleware — sets req.userId on every request
app.use(userMiddleware);

// Serve static client build
app.use(express.static(path.join(__dirname, '../../client/dist')));

// Health check — includes version for client compatibility checking
const pkg = require('../../../package.json');
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: pkg.version, apiVersion: 1, service: 'not-ify-server' });
});

// Service health check — tests connectivity to all external dependencies
app.get('/api/health/services', async (req, res) => {
  const checks = {};
  async function check(name, fn) {
    const start = Date.now();
    try {
      const result = await fn();
      checks[name] = { status: 'ok', latency: Date.now() - start, ...result };
    } catch (err) {
      checks[name] = { status: 'error', latency: Date.now() - start, error: err.message };
    }
  }
  await Promise.all([
    check('musicbrainz', async () => {
      const r = await fetch('https://musicbrainz.org/ws/2/artist/5b11f4ce-a62d-471e-81fc-a69a8278c7da?fmt=json', {
        signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Not-ify/1.0 (personal-use)' },
      });
      return { ok: r.ok };
    }),
    check('lastfm', async () => {
      const r = await fetch('https://ws.audioscrobbler.com/2.0/?method=chart.gettoptracks&format=json&api_key=dummy&limit=1', {
        signal: AbortSignal.timeout(8000),
      });
      return { ok: r.status !== 0 }; // 403 is fine — means the service is reachable
    }),
    check('youtube', async () => {
      const r = await fetch('https://www.youtube.com/', { signal: AbortSignal.timeout(8000) });
      return { ok: r.ok };
    }),
    check('realdebrid', async () => {
      const r = await fetch('https://api.real-debrid.com/rest/1.0/disable_access_token', {
        signal: AbortSignal.timeout(8000),
      });
      return { ok: r.status !== 0 };
    }),
    check('vpn', async () => {
      const proxy = process.env.VPN_PROXY;
      if (!proxy) return { status: 'disabled', ok: true };
      const { getProxyFetch } = require('./services/proxy');
      const pf = getProxyFetch();
      const r = await pf('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(8000) });
      const data = await r.json();
      return { ok: true, ip: data.ip };
    }),
    check('gluetun', async () => {
      const url = process.env.GLUETUN_CONTROL_URL;
      if (!url) return { status: 'disabled', ok: true };
      const r = await fetch(`${url}/v1/vpn/settings`, { signal: AbortSignal.timeout(5000) });
      const data = await r.json();
      const region = data?.provider?.server_selection?.regions?.[0] || 'unknown';
      return { ok: true, region };
    }),
  ]);
  const overall = Object.values(checks).every(c => c.status === 'ok') ? 'ok' : 'degraded';
  res.json({ status: overall, version: pkg.version, checks });
});

// Diagnostics — full internal service state (admin only)
const diagnostics = require('./services/diagnostics');
app.get('/api/diagnostics', adminGuard, async (req, res) => {
  try {
    const data = await diagnostics.collect();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
      headers: { 'User-Agent': 'Not-ify/1.0.0 (personal-use)' },
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

// Wikipedia summary proxy (avoids CORS, memory-cached)
const wikiCache = new Map();
const WIKI_CACHE_TTL = 60 * 60 * 1000; // 1 hour
app.get('/api/wiki/summary', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url param' });

  // Extract article title from Wikipedia URL, or resolve Wikidata QID
  let title;
  const wikiMatch = url.match(/wikipedia\.org\/wiki\/(.+?)(?:#.*)?$/);
  const wikidataMatch = url.match(/wikidata\.org\/wiki\/(Q\d+)/);
  if (wikiMatch) {
    title = decodeURIComponent(wikiMatch[1]);
  } else if (wikidataMatch) {
    // Resolve Wikidata QID to Wikipedia article title
    try {
      const wdRes = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikidataMatch[1]}&props=sitelinks&sitefilter=enwiki&format=json`, {
        headers: { 'User-Agent': 'Not-ify/1.0.0 (personal-use)' },
        signal: AbortSignal.timeout(5000),
      });
      const wdData = await wdRes.json();
      title = wdData.entities?.[wikidataMatch[1]]?.sitelinks?.enwiki?.title;
      if (!title) return res.status(404).json({ error: 'No English Wikipedia article for this Wikidata entity' });
    } catch (err) {
      return res.status(502).json({ error: 'Wikidata resolution failed' });
    }
  } else {
    return res.status(400).json({ error: 'Not a valid Wikipedia or Wikidata URL' });
  }

  // Check cache
  const cached = wikiCache.get(title);
  if (cached && Date.now() < cached.expires) {
    return res.json(cached.data);
  }

  try {
    const wikiRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
      headers: { 'User-Agent': 'Not-ify/1.0.0 (personal-use)' },
      signal: AbortSignal.timeout(5000),
    });
    if (!wikiRes.ok) return res.status(404).json({ error: 'Wikipedia article not found' });
    const data = await wikiRes.json();
    const result = {
      extract: data.extract || null,
      description: data.description || null,
      thumbnail: data.thumbnail?.source || null,
    };
    wikiCache.set(title, { data: result, expires: Date.now() + WIKI_CACHE_TTL });
    res.json(result);
  } catch (err) {
    console.error(`Wikipedia fetch failed: ${err.message}`);
    res.status(502).json({ error: 'Wikipedia fetch failed' });
  }
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
        headers: { 'User-Agent': 'Not-ify/1.0.0 (personal-use)' },
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
          headers: { 'User-Agent': 'Not-ify/1.0.0 (personal-use)' },
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

// Spotify/Last.fm import pipeline
const importRouter = require('./api/import');
app.use('/api', importRouter);

// DLNA/UPnP casting
const castRouter = require('./api/cast');
app.use('/api', castRouter);

// Quality upgrader routes
app.use('/api', upgradeRouter);

// Real-Debrid config API (admin only)
const rdConfigRouter = require('./api/realdebrid-config');
app.use('/api/realdebrid', adminGuard, rdConfigRouter);

// Library config API (admin only) — music directory configuration + filesystem browser
const libraryConfigRouter = require('./api/library-config');
app.use('/api/library-config', adminGuard, libraryConfigRouter);

// Soulseek config API (admin only)
const soulseekConfigRouter = require('./api/soulseek-config');
app.use('/api/soulseek', adminGuard, soulseekConfigRouter);

// VPN config API (admin only)
const vpnConfigRouter = require('./api/vpn-config');
app.use('/api/vpn', adminGuard, vpnConfigRouter);

// Server admin API (admin only) — active-jobs check + restart
const serverAdminRouter = require('./api/server-admin');
app.use('/api/server', adminGuard, serverAdminRouter);

// Activity log API — verbose download/pipeline event stream for debugging UI
const activityLog = require('./services/activity-log');
app.get('/api/activity', (req, res) => {
  const since = req.query.since ? parseInt(req.query.since, 10) : undefined;
  const category = req.query.category || undefined;
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 100;
  res.json(activityLog.getEntries({ since, category, limit }));
});
// SSE stream for real-time activity events
app.get('/api/activity/stream', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(':\n\n');
  const remove = activityLog.onEntry((entry) => {
    try { res.write(`data: ${JSON.stringify(entry)}\n\n`); } catch {}
  });
  req.on('close', remove);
});

// --- Per-user API endpoints ---

// GET /api/users — list available users (for user picker)
app.get('/api/users', (req, res) => {
  res.json(db.getUsers());
});

// Search history
app.get('/api/search-history', (req, res) => {
  res.json(db.getSearchHistory(req.userId));
});
app.post('/api/search-history', (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Missing query' });
  db.addSearchHistory(req.userId, query);
  res.json(db.getSearchHistory(req.userId));
});
app.delete('/api/search-history', (req, res) => {
  const { query } = req.body || {};
  if (query) {
    db.removeSearchHistory(req.userId, query);
  } else {
    db.clearSearchHistory(req.userId);
  }
  res.json(db.getSearchHistory(req.userId));
});

// Favorites
app.get('/api/favorites', (req, res) => {
  res.json(db.getFavorites(req.userId));
});
app.post('/api/favorites', (req, res) => {
  const { trackId, artist, album, title } = req.body;
  if (!trackId || !artist || !title) return res.status(400).json({ error: 'Missing required fields' });
  db.addFavorite(req.userId, { trackId, artist, album: album || '', title });
  res.json({ success: true });
});
app.delete('/api/favorites/:trackId', (req, res) => {
  db.removeFavorite(req.userId, req.params.trackId);
  res.json({ success: true });
});

// User session (server-side persistence)
app.get('/api/session', (req, res) => {
  res.json(db.getUserSession(req.userId));
});
app.put('/api/session', (req, res) => {
  const { queue, state } = req.body;
  db.saveUserSession(req.userId, { queue, state });
  res.json({ success: true });
});

// User settings
app.get('/api/settings', (req, res) => {
  res.json(db.getAllUserSettings(req.userId));
});
app.put('/api/settings', (req, res) => {
  const settings = req.body;
  for (const [key, value] of Object.entries(settings)) {
    db.setUserSetting(req.userId, key, value);
  }
  res.json({ success: true });
});

// SPA fallback — serve index.html for non-API routes
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, '../../client/dist/index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Client not built yet. Run: cd client && npm run build' });
  }
});

// Safety net — log unhandled rejections instead of crashing the process
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason instanceof Error ? reason.message : reason);
});

// Only bind to a port when run directly (not when required by tests)
if (require.main === module) {
  // Run migration before starting server
  migrate();

  // Clean up orphaned staging directories (from crashed jobs)
  try {
    const stagingDir = path.join(process.env.MUSIC_DIR || '/app/music', '_staging');
    if (fs.existsSync(stagingDir)) {
      const ONE_HOUR = 60 * 60 * 1000;
      for (const entry of fs.readdirSync(stagingDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const entryPath = path.join(stagingDir, entry.name);
          const stat = fs.statSync(entryPath);
          if (Date.now() - stat.mtimeMs > ONE_HOUR) {
            fs.rmSync(entryPath, { recursive: true, force: true });
            console.log(`[startup] Cleaned up stale staging dir: ${entry.name}`);
          }
        }
      }
    }
  } catch (err) {
    console.warn('[startup] Staging cleanup failed:', err.message);
  }

  // Start DLNA device discovery (disabled in CI/test via DLNA_ENABLED=false)
  if (process.env.DLNA_ENABLED !== 'false') {
    const dlna = require('./services/dlna');
    dlna.startDiscovery();
  }

  // Start job queue worker
  const jobWorker = require('./services/job-worker');
  jobWorker.setProcessor(require('./services/job-processor').process);
  jobWorker.start();
  console.log('[job-worker] Started polling for queued jobs');

  // Start quality upgrader background tick (every 5 minutes)
  // Only runs when the system is idle (no active downloads)
  const { getUpgrader } = require('./api/upgrade');
  diagnostics.registerUpgrader(() => { try { return getUpgrader(); } catch { return null; } });
  const upgrader = getUpgrader();
  let upgraderRunning = false;
  const UPGRADER_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  setInterval(async () => {
    if (upgraderRunning) return; // prevent concurrent ticks
    upgraderRunning = true;
    try {
      await upgrader.tick();
    } catch (err) {
      console.error('[upgrader] tick error:', err.message);
    } finally {
      upgraderRunning = false;
    }
  }, UPGRADER_INTERVAL_MS);

  // Sync library tracks table with filesystem on startup
  const library = require('./api/library');
  library.scanAndSync();

  // Start Last.fm scrobble delta sync scheduler for users with existing auth
  const scrobbleSync = require('./services/scrobble-sync');
  scrobbleSync.startDeltaSyncScheduler();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Not-ify server running on port ${PORT}`);
  });
}

module.exports = app;
