'use strict';

const express = require('express');
const path = require('path');
const router = express.Router();
const dlna = require('../services/dlna');
const castSession = require('../services/cast-session');
const streamAuth = require('../services/stream-auth');
const { getLanIp } = require('../services/lan-ip');
const { getTrackMap, MIME_TYPES } = require('./library');

const PORT = process.env.PORT || 3000;

function getLanBase() {
  return `http://${getLanIp()}:${PORT}`;
}

function trackMimeType(format) {
  const ext = format ? `.${format.toLowerCase()}` : '.mp3';
  return MIME_TYPES[ext] || 'audio/mpeg';
}

// ── GET /api/cast/devices ─────────────────────────────────────────────────────

router.get('/cast/devices', (req, res) => {
  res.json(dlna.getDevices());
});

// ── POST /api/cast/play — library track ───────────────────────────────────────

router.post('/cast/play', async (req, res) => {
  const { deviceUsn, trackId, albumInfo, queue } = req.body;
  if (!deviceUsn || !trackId) return res.status(400).json({ error: 'Missing deviceUsn or trackId' });

  const { map, tracks } = getTrackMap();
  const filePath = map[trackId];
  if (!filePath) return res.status(404).json({ error: 'Track not found' });

  const track = tracks.find(t => t.id === trackId);
  const base = getLanBase();
  const streamUrl = streamAuth.generateSignedUrl(trackId, base, 7200);
  const mimeType = trackMimeType(track?.format);

  const coverBase = albumInfo?.coverArt
    ? (albumInfo.coverArt.startsWith('http') ? albumInfo.coverArt : `${base}${albumInfo.coverArt}`)
    : '';

  const metadata = dlna.buildDidlLite({
    title: track?.title || 'Unknown',
    artist: track?.artist || albumInfo?.artist || 'Unknown',
    album: track?.album || albumInfo?.album || '',
    albumArtUrl: coverBase,
    streamUrl,
    mimeType,
  });

  try {
    await dlna.play(deviceUsn, streamUrl, metadata);
    const userId = req.userId || 'default';
    castSession.setSession(userId, {
      deviceUsn,
      queue: queue || [{ id: trackId, title: track?.title, artist: track?.artist }],
      queueIndex: 0,
    });
    const device = dlna.getDevices().find(d => d.usn === deviceUsn);
    res.json({ status: 'playing', device: device?.friendlyName || deviceUsn });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/cast/play/yt — YouTube track ────────────────────────────────────

router.post('/cast/play/yt', async (req, res) => {
  const { deviceUsn, videoId, title, artist, album, coverArt } = req.body;
  if (!deviceUsn || !videoId) return res.status(400).json({ error: 'Missing deviceUsn or videoId' });

  const base = getLanBase();
  const streamUrl = streamAuth.generateSignedYtUrl(videoId, base, 7200);

  const metadata = dlna.buildDidlLite({
    title: title || 'Unknown',
    artist: artist || 'Unknown',
    album: album || '',
    albumArtUrl: coverArt || '',
    streamUrl,
    mimeType: 'audio/mpeg',
  });

  try {
    await dlna.play(deviceUsn, streamUrl, metadata);
    const userId = req.userId || 'default';
    castSession.setSession(userId, {
      deviceUsn,
      queue: [{ id: `yt-${videoId}`, title, artist, isYt: true, ytVideoId: videoId }],
      queueIndex: 0,
    });
    const device = dlna.getDevices().find(d => d.usn === deviceUsn);
    res.json({ status: 'playing', device: device?.friendlyName || deviceUsn });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/cast/pause ──────────────────────────────────────────────────────

router.post('/cast/pause', async (req, res) => {
  const { deviceUsn } = req.body;
  if (!deviceUsn) return res.status(400).json({ error: 'Missing deviceUsn' });
  try {
    await dlna.pause(deviceUsn);
    res.json({ status: 'paused' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/cast/stop ───────────────────────────────────────────────────────

router.post('/cast/stop', async (req, res) => {
  const { deviceUsn } = req.body;
  if (!deviceUsn) return res.status(400).json({ error: 'Missing deviceUsn' });
  try {
    await dlna.stop(deviceUsn);
    castSession.clearSession(req.userId || 'default');
    res.json({ status: 'stopped' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/cast/seek ───────────────────────────────────────────────────────

router.post('/cast/seek', async (req, res) => {
  const { deviceUsn, position } = req.body;
  if (!deviceUsn || position === undefined) return res.status(400).json({ error: 'Missing deviceUsn or position' });
  try {
    await dlna.seek(deviceUsn, Number(position));
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/cast/volume ─────────────────────────────────────────────────────

router.post('/cast/volume', async (req, res) => {
  const { deviceUsn, level } = req.body;
  if (!deviceUsn || level === undefined) return res.status(400).json({ error: 'Missing deviceUsn or level' });
  try {
    await dlna.setVolume(deviceUsn, Number(level));
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/cast/status ──────────────────────────────────────────────────────

router.get('/cast/status', async (req, res) => {
  const { deviceUsn } = req.query;
  if (!deviceUsn) return res.status(400).json({ error: 'Missing deviceUsn' });
  try {
    const [position, state, volume] = await Promise.all([
      dlna.getPosition(deviceUsn),
      dlna.getTransportState(deviceUsn),
      dlna.getVolume(deviceUsn),
    ]);
    const userId = req.userId || 'default';
    res.json({ ...position, state, volume, currentTrack: castSession.currentTrack(userId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/cast/status/stream — SSE ────────────────────────────────────────

router.get('/cast/status/stream', async (req, res) => {
  const { deviceUsn } = req.query;
  if (!deviceUsn) return res.status(400).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const userId = req.userId || 'default';

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const onDeviceLost = ({ usn }) => {
    if (usn === deviceUsn) {
      send({ event: 'deviceLost', deviceUsn });
    }
  };
  dlna.on('deviceLost', onDeviceLost);

  const poll = setInterval(async () => {
    try {
      const [position, state, volume] = await Promise.all([
        dlna.getPosition(deviceUsn),
        dlna.getTransportState(deviceUsn),
        dlna.getVolume(deviceUsn),
      ]);
      send({ ...position, state, volume, currentTrack: castSession.currentTrack(userId) });
    } catch {
      send({ event: 'error', message: 'Failed to poll device' });
    }
  }, 1000);

  req.on('close', () => {
    clearInterval(poll);
    dlna.off('deviceLost', onDeviceLost);
  });
});

// ── POST /api/cast/next ───────────────────────────────────────────────────────

router.post('/cast/next', async (req, res) => {
  const userId = req.userId || 'default';
  const session = castSession.getSession(userId);
  if (!session) return res.status(400).json({ error: 'No active cast session' });

  const next = castSession.advanceQueue(userId);
  if (!next) return res.status(400).json({ error: 'No next track in queue' });

  const base = getLanBase();
  try {
    if (next.isYt) {
      const streamUrl = streamAuth.generateSignedYtUrl(next.ytVideoId, base, 7200);
      const metadata = dlna.buildDidlLite({ title: next.title, artist: next.artist, album: '', streamUrl, mimeType: 'audio/mpeg' });
      await dlna.play(session.deviceUsn, streamUrl, metadata);
    } else {
      const { map, tracks } = getTrackMap();
      const track = tracks.find(t => t.id === next.id);
      const streamUrl = streamAuth.generateSignedUrl(next.id, base, 7200);
      const mimeType = trackMimeType(track?.format);
      const metadata = dlna.buildDidlLite({ title: next.title || 'Unknown', artist: next.artist || 'Unknown', album: '', streamUrl, mimeType });
      await dlna.play(session.deviceUsn, streamUrl, metadata);
    }
    res.json({ status: 'playing', track: next });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/cast/prev ───────────────────────────────────────────────────────

router.post('/cast/prev', async (req, res) => {
  const userId = req.userId || 'default';
  const session = castSession.getSession(userId);
  if (!session) return res.status(400).json({ error: 'No active cast session' });

  const prev = castSession.previousInQueue(userId);
  if (!prev) return res.status(400).json({ error: 'No previous track' });

  const base = getLanBase();
  try {
    if (prev.isYt) {
      const streamUrl = streamAuth.generateSignedYtUrl(prev.ytVideoId, base, 7200);
      const metadata = dlna.buildDidlLite({ title: prev.title, artist: prev.artist, album: '', streamUrl, mimeType: 'audio/mpeg' });
      await dlna.play(session.deviceUsn, streamUrl, metadata);
    } else {
      const { map, tracks } = getTrackMap();
      const track = tracks.find(t => t.id === prev.id);
      const streamUrl = streamAuth.generateSignedUrl(prev.id, base, 7200);
      const mimeType = trackMimeType(track?.format);
      const metadata = dlna.buildDidlLite({ title: prev.title || 'Unknown', artist: prev.artist || 'Unknown', album: '', streamUrl, mimeType });
      await dlna.play(session.deviceUsn, streamUrl, metadata);
    }
    res.json({ status: 'playing', track: prev });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
