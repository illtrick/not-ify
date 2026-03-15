const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_PATH = path.join(__dirname, '../../../config/settings.json');
const QUEUE_PATH = path.join(__dirname, '../../../config/lastfm-queue.json');
const LFM_BASE = 'https://ws.audioscrobbler.com/2.0/';
const LFM_AUTH_URL = 'https://www.last.fm/api/auth/';

// Rate limiter: max 5 req/sec
let lastRequestTime = 0;

// In-memory cache
const cache = new Map();

// Failed scrobble queue (persisted to disk)
let scrobbleQueue = [];
try {
  if (fs.existsSync(QUEUE_PATH)) {
    scrobbleQueue = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));
  }
} catch { scrobbleQueue = []; }

function saveQueue() {
  try { fs.writeFileSync(QUEUE_PATH, JSON.stringify(scrobbleQueue, null, 2)); } catch {}
}

// Auto-flush every 5 minutes
setInterval(() => { if (scrobbleQueue.length > 0) flushScrobbleQueue().catch(() => {}); }, 5 * 60 * 1000);

function getConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    return config.lastfm || {};
  } catch { return {}; }
}

function saveConfig(updates) {
  let config = {};
  try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); } catch {}
  config.lastfm = { ...(config.lastfm || {}), ...updates };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function generateApiSig(params, secret) {
  const sorted = Object.keys(params).sort();
  let str = '';
  for (const key of sorted) {
    str += key + params[key];
  }
  str += secret;
  return crypto.createHash('md5').update(str, 'utf8').digest('hex');
}

async function lfmFetch(params, method = 'GET') {
  const now = Date.now();
  const wait = 200 - (now - lastRequestTime);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestTime = Date.now();

  const cfg = getConfig();
  const allParams = { ...params, api_key: cfg.apiKey, format: 'json' };

  // Add signature if we have a secret
  if (cfg.apiSecret) {
    // Exclude 'format' from signature
    const sigParams = { ...allParams };
    delete sigParams.format;
    allParams.api_sig = generateApiSig(sigParams, cfg.apiSecret);
  }

  let res;
  if (method === 'POST') {
    const body = new URLSearchParams(allParams).toString();
    res = await fetch(LFM_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Not-ify/1.0.0' },
      body,
      signal: AbortSignal.timeout(10000),
    });
  } else {
    const qs = new URLSearchParams(allParams).toString();
    res = await fetch(`${LFM_BASE}?${qs}`, {
      headers: { 'User-Agent': 'Not-ify/1.0.0' },
      signal: AbortSignal.timeout(10000),
    });
  }

  const data = await res.json();
  if (data.error) {
    throw new Error(`Last.fm error ${data.error}: ${data.message}`);
  }
  return data;
}

function cached(key, ttlMs, fn) {
  return async (...args) => {
    const cacheKey = `${key}:${JSON.stringify(args)}`;
    const hit = cache.get(cacheKey);
    if (hit && hit.expires > Date.now()) return hit.data;
    const data = await fn(...args);
    cache.set(cacheKey, { data, expires: Date.now() + ttlMs });
    return data;
  };
}

// --- Auth ---

async function getAuthToken() {
  const cfg = getConfig();
  if (!cfg.apiKey) throw new Error('Last.fm API key not configured');
  const data = await lfmFetch({ method: 'auth.getToken' });
  const token = data.token;
  return { token, authUrl: `${LFM_AUTH_URL}?api_key=${cfg.apiKey}&token=${token}` };
}

async function getSession(token) {
  const cfg = getConfig();
  if (!cfg.apiKey || !cfg.apiSecret) throw new Error('Last.fm API key/secret not configured');
  // auth.getSession needs signed request
  const params = { method: 'auth.getSession', token, api_key: cfg.apiKey };
  params.api_sig = generateApiSig(params, cfg.apiSecret);
  params.format = 'json';

  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${LFM_BASE}?${qs}`, {
    headers: { 'User-Agent': 'Not-ify/1.0.0' },
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Last.fm auth error: ${data.message}`);

  const session = data.session;
  saveConfig({ sessionKey: session.key, username: session.name });
  return { name: session.name, key: session.key };
}

// --- Scrobbling ---

async function updateNowPlaying({ artist, track, album, duration }) {
  const cfg = getConfig();
  if (!cfg.sessionKey) return;

  const params = { method: 'track.updateNowPlaying', artist, track, sk: cfg.sessionKey };
  if (album) params.album = album;
  if (duration) params.duration = String(Math.round(duration));

  try {
    await lfmFetch(params, 'POST');
    console.log(`[lastfm] Now playing: ${artist} - ${track}`);
  } catch (err) {
    console.warn(`[lastfm] Now playing failed: ${err.message}`);
  }
}

async function scrobble({ artist, track, album, timestamp, duration }) {
  const cfg = getConfig();
  if (!cfg.sessionKey) {
    scrobbleQueue.push({ artist, track, album, timestamp, duration });
    saveQueue();
    return;
  }

  const params = {
    method: 'track.scrobble',
    'artist[0]': artist,
    'track[0]': track,
    'timestamp[0]': String(timestamp),
    sk: cfg.sessionKey,
  };
  if (album) params['album[0]'] = album;
  if (duration) params['duration[0]'] = String(Math.round(duration));

  try {
    await lfmFetch(params, 'POST');
    console.log(`[lastfm] Scrobbled: ${artist} - ${track}`);
    // Try flushing queue on success
    if (scrobbleQueue.length > 0) flushScrobbleQueue().catch(() => {});
  } catch (err) {
    console.warn(`[lastfm] Scrobble failed, queued: ${err.message}`);
    scrobbleQueue.push({ artist, track, album, timestamp, duration });
    saveQueue();
  }
}

async function flushScrobbleQueue() {
  if (scrobbleQueue.length === 0) return { flushed: 0 };
  const cfg = getConfig();
  if (!cfg.sessionKey) return { flushed: 0 };

  const batch = scrobbleQueue.splice(0, 50);
  const params = { method: 'track.scrobble', sk: cfg.sessionKey };
  batch.forEach((s, i) => {
    params[`artist[${i}]`] = s.artist;
    params[`track[${i}]`] = s.track;
    params[`timestamp[${i}]`] = String(s.timestamp);
    if (s.album) params[`album[${i}]`] = s.album;
    if (s.duration) params[`duration[${i}]`] = String(Math.round(s.duration));
  });

  try {
    await lfmFetch(params, 'POST');
    console.log(`[lastfm] Flushed ${batch.length} queued scrobbles`);
    saveQueue();
    return { flushed: batch.length };
  } catch (err) {
    // Put them back
    scrobbleQueue.unshift(...batch);
    saveQueue();
    console.warn(`[lastfm] Queue flush failed: ${err.message}`);
    return { flushed: 0 };
  }
}

// --- Reading history ---

const getRecentTracks = cached('recent', 2 * 60 * 1000, async (user, limit = 20) => {
  const data = await lfmFetch({ method: 'user.getRecentTracks', user, limit: String(limit) });
  return data.recenttracks?.track || [];
});

const getTopArtists = cached('topArtists', 10 * 60 * 1000, async (user, period = 'overall', limit = 10) => {
  const data = await lfmFetch({ method: 'user.getTopArtists', user, period, limit: String(limit) });
  return data.topartists?.artist || [];
});

const getTopAlbums = cached('topAlbums', 10 * 60 * 1000, async (user, period = 'overall', limit = 10) => {
  const data = await lfmFetch({ method: 'user.getTopAlbums', user, period, limit: String(limit) });
  return data.topalbums?.album || [];
});

const getTopTracks = cached('topTracks', 10 * 60 * 1000, async (user, period = 'overall', limit = 10) => {
  const data = await lfmFetch({ method: 'user.getTopTracks', user, period, limit: String(limit) });
  return data.toptracks?.track || [];
});

module.exports = {
  getConfig,
  saveConfig,
  getAuthToken,
  getSession,
  updateNowPlaying,
  scrobble,
  flushScrobbleQueue,
  getScrobbleQueue: () => scrobbleQueue,
  getRecentTracks,
  getTopArtists,
  getTopAlbums,
  getTopTracks,
};
