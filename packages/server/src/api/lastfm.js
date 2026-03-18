const express = require('express');
const lfm = require('../services/lastfm');

const router = express.Router();

// GET /api/lastfm/status — Auth state (per-user)
router.get('/lastfm/status', (req, res) => {
  const cfg = lfm.getConfig(req.userId);
  res.json({
    configured: !!(cfg.apiKey && cfg.apiSecret),
    authenticated: !!cfg.sessionKey,
    username: cfg.username || null,
  });
});

// POST /api/lastfm/config — Save API key + secret (per-user)
router.post('/lastfm/config', (req, res) => {
  const { apiKey, apiSecret } = req.body;
  if (!apiKey || !apiSecret) return res.status(400).json({ error: 'Missing apiKey or apiSecret' });
  lfm.saveConfig(req.userId, { apiKey, apiSecret });
  res.json({ success: true });
});

// GET /api/lastfm/auth/token — Get auth token + URL (per-user)
router.get('/lastfm/auth/token', async (req, res) => {
  try {
    const result = await lfm.getAuthToken(req.userId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/lastfm/auth/session — Exchange token for session (per-user)
router.post('/lastfm/auth/session', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Missing token' });
  try {
    const session = await lfm.getSession(token, req.userId);
    res.json({ success: true, username: session.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/lastfm/disconnect — Clear session (per-user)
router.post('/lastfm/disconnect', (req, res) => {
  lfm.saveConfig(req.userId, { sessionKey: '', username: '' });
  res.json({ success: true });
});

// POST /api/lastfm/nowplaying (per-user)
router.post('/lastfm/nowplaying', async (req, res) => {
  const { artist, track, album, duration } = req.body;
  if (!artist || !track) return res.status(400).json({ error: 'Missing artist or track' });
  await lfm.updateNowPlaying({ artist, track, album, duration }, req.userId);
  res.json({ success: true });
});

// POST /api/lastfm/scrobble (per-user)
router.post('/lastfm/scrobble', async (req, res) => {
  const { artist, track, album, timestamp, duration } = req.body;
  if (!artist || !track || !timestamp) return res.status(400).json({ error: 'Missing required fields' });
  await lfm.scrobble({ artist, track, album, timestamp, duration }, req.userId);
  res.json({ success: true });
});

// GET /api/lastfm/recent (per-user)
router.get('/lastfm/recent', async (req, res) => {
  const cfg = lfm.getConfig(req.userId);
  if (!cfg.username) return res.json([]);
  try {
    const tracks = await lfm.getRecentTracks(cfg.username, parseInt(req.query.limit) || 20);
    res.json(tracks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/lastfm/top/artists (per-user)
router.get('/lastfm/top/artists', async (req, res) => {
  const cfg = lfm.getConfig(req.userId);
  if (!cfg.username) return res.json([]);
  try {
    const artists = await lfm.getTopArtists(cfg.username, req.query.period || 'overall', parseInt(req.query.limit) || 10);
    res.json(artists);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/lastfm/top/albums (per-user)
router.get('/lastfm/top/albums', async (req, res) => {
  const cfg = lfm.getConfig(req.userId);
  if (!cfg.username) return res.json([]);
  try {
    const albums = await lfm.getTopAlbums(cfg.username, req.query.period || 'overall', parseInt(req.query.limit) || 10);
    res.json(albums);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/lastfm/top/tracks (per-user)
router.get('/lastfm/top/tracks', async (req, res) => {
  const cfg = lfm.getConfig(req.userId);
  if (!cfg.username) return res.json([]);
  try {
    const tracks = await lfm.getTopTracks(cfg.username, req.query.period || 'overall', parseInt(req.query.limit) || 10);
    res.json(tracks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/lastfm/artist/top-tracks — Top tracks for an artist (uses any user's API key)
router.get('/lastfm/artist/top-tracks', async (req, res) => {
  const { artist } = req.query;
  if (!artist) return res.json([]);
  const cfg = lfm.getConfig(req.userId);
  if (!cfg.apiKey) return res.json([]);
  try {
    const tracks = await lfm.getArtistTopTracks(artist, parseInt(req.query.limit) || 10);
    res.json(tracks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/lastfm/queue — Failed scrobble queue (per-user)
router.get('/lastfm/queue', (req, res) => {
  const queue = lfm.getScrobbleQueue(req.userId);
  res.json({ count: queue.length, items: queue.slice(0, 20) });
});

// POST /api/lastfm/queue/flush — Manual queue flush (per-user)
router.post('/lastfm/queue/flush', async (req, res) => {
  try {
    const result = await lfm.flushScrobbleQueue(req.userId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
