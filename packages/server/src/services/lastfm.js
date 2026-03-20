const crypto = require('crypto');
const db = require('./db');

const LFM_BASE = 'https://ws.audioscrobbler.com/2.0/';
const LFM_AUTH_URL = 'https://www.last.fm/api/auth/';

// Rate limiter: max 5 req/sec
let lastRequestTime = 0;

// In-memory cache
const cache = new Map();

// Auto-flush every 5 minutes for all users with queued scrobbles
setInterval(() => {
  const users = db.getAllUsersWithScrobbleQueue();
  for (const userId of users) {
    flushScrobbleQueue(userId).catch(() => {});
  }
}, 5 * 60 * 1000);

function getConfig(userId = 'default') {
  return db.getLastfmConfig(userId);
}

function saveConfig(userId = 'default', updates) {
  db.saveLastfmConfig(userId, updates);
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

async function lfmFetch(params, method = 'GET', userId = 'default') {
  const now = Date.now();
  const wait = 200 - (now - lastRequestTime);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestTime = Date.now();

  const cfg = getConfig(userId);
  const allParams = { ...params, api_key: cfg.apiKey, format: 'json' };

  // Add signature if we have a secret
  if (cfg.apiSecret) {
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

async function getAuthToken(userId = 'default') {
  const cfg = getConfig(userId);
  if (!cfg.apiKey) throw new Error('Last.fm API key not configured');
  const data = await lfmFetch({ method: 'auth.getToken' }, 'GET', userId);
  const token = data.token;
  return { token, authUrl: `${LFM_AUTH_URL}?api_key=${cfg.apiKey}&token=${token}` };
}

async function getSession(token, userId = 'default') {
  const cfg = getConfig(userId);
  if (!cfg.apiKey || !cfg.apiSecret) throw new Error('Last.fm API key/secret not configured');
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
  saveConfig(userId, { sessionKey: session.key, username: session.name });
  return { name: session.name, key: session.key };
}

// --- Scrobbling ---

async function updateNowPlaying({ artist, track, album, duration }, userId = 'default') {
  const cfg = getConfig(userId);
  if (!cfg.sessionKey) return;

  const params = { method: 'track.updateNowPlaying', artist, track, sk: cfg.sessionKey };
  if (album) params.album = album;
  if (duration) params.duration = String(Math.round(duration));

  try {
    await lfmFetch(params, 'POST', userId);
    console.log(`[lastfm] Now playing (${userId}): ${artist} - ${track}`);
  } catch (err) {
    console.warn(`[lastfm] Now playing failed (${userId}): ${err.message}`);
  }
}

async function scrobble({ artist, track, album, timestamp, duration }, userId = 'default') {
  const cfg = getConfig(userId);
  if (!cfg.sessionKey) {
    db.addToScrobbleQueue(userId, { artist, track, album, timestamp, duration });
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
    await lfmFetch(params, 'POST', userId);
    console.log(`[lastfm] Scrobbled (${userId}): ${artist} - ${track}`);
    if (db.getScrobbleQueue(userId).length > 0) flushScrobbleQueue(userId).catch(() => {});
  } catch (err) {
    console.warn(`[lastfm] Scrobble failed, queued (${userId}): ${err.message}`);
    db.addToScrobbleQueue(userId, { artist, track, album, timestamp, duration });
  }
}

async function flushScrobbleQueue(userId = 'default') {
  const queue = db.getScrobbleQueue(userId);
  if (queue.length === 0) return { flushed: 0 };
  const cfg = getConfig(userId);
  if (!cfg.sessionKey) return { flushed: 0 };

  const batch = queue.slice(0, 50);
  const params = { method: 'track.scrobble', sk: cfg.sessionKey };
  batch.forEach((s, i) => {
    params[`artist[${i}]`] = s.artist;
    params[`track[${i}]`] = s.track;
    params[`timestamp[${i}]`] = String(s.timestamp);
    if (s.album) params[`album[${i}]`] = s.album;
    if (s.duration) params[`duration[${i}]`] = String(Math.round(s.duration));
  });

  try {
    await lfmFetch(params, 'POST', userId);
    console.log(`[lastfm] Flushed ${batch.length} queued scrobbles for ${userId}`);
    db.removeFromScrobbleQueue(batch.map(s => s.id));
    return { flushed: batch.length };
  } catch (err) {
    console.warn(`[lastfm] Queue flush failed (${userId}): ${err.message}`);
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

const getArtistTopTracks = cached('artistTopTracks', 30 * 60 * 1000, async (artist, limit = 10) => {
  const data = await lfmFetch({ method: 'artist.getTopTracks', artist, limit: String(limit), autocorrect: '1' });
  const tracks = data.toptracks?.track || [];
  return tracks.map(t => ({
    name: t.name,
    playcount: t.playcount,
    listeners: t.listeners,
    url: t.url,
    rank: t['@attr']?.rank,
  }));
});

async function getRecentTracksPage(user, page = 1, limit = 200, from = null) {
  // Apply rate limiter (max 5 req/sec — 200ms minimum gap)
  const now = Date.now();
  const wait = 200 - (now - lastRequestTime);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestTime = Date.now();

  const params = new URLSearchParams({
    method: 'user.getrecenttracks',
    user,
    api_key: '', // placeholder — resolved below
    format: 'json',
    limit: String(limit),
    page: String(page),
  });

  // We need an API key — try default, then fall back to any user that has one
  let apiKey = getConfig('default').apiKey;
  if (!apiKey) {
    const users = db.getUsers ? db.getUsers() : [];
    for (const u of users) {
      const c = getConfig(u.id);
      if (c.apiKey) { apiKey = c.apiKey; break; }
    }
  }
  apiKey = apiKey || '';
  params.set('api_key', apiKey);

  if (from) params.set('from', String(from));

  const response = await fetch(`${LFM_BASE}?${params}`, {
    headers: { 'User-Agent': 'Not-ify/1.0.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Last.fm API ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(`Last.fm error ${data.error}: ${data.message}`);
  return {
    tracks: data.recenttracks?.track || [],
    totalPages: parseInt(data.recenttracks?.['@attr']?.totalPages || '1', 10),
    total: parseInt(data.recenttracks?.['@attr']?.total || '0', 10),
  };
}

module.exports = {
  getConfig,
  saveConfig,
  getAuthToken,
  getSession,
  updateNowPlaying,
  scrobble,
  flushScrobbleQueue,
  getScrobbleQueue: (userId = 'default') => db.getScrobbleQueue(userId),
  getRecentTracks,
  getTopArtists,
  getTopAlbums,
  getTopTracks,
  getArtistTopTracks,
  getRecentTracksPage,
};
