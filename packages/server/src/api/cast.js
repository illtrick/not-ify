'use strict';

const express = require('express');
const path = require('path');
const router = express.Router();
const dlna = require('../services/dlna');
const castSession = require('../services/cast-session');
const streamAuth = require('../services/stream-auth');
const { getLanIp } = require('../services/lan-ip');
const { getTrackMap, MIME_TYPES } = require('./library');

const log = (...args) => console.log('[cast]', ...args);

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

// ── Helper: build track info for casting ──────────────────────────────────────

function _buildTrackCastInfo(trackId, albumInfo) {
  const { map, tracks } = getTrackMap();
  const filePath = map[trackId];
  if (!filePath) return null;
  const track = tracks.find(t => t.id === trackId);
  const base = getLanBase();
  const streamUrl = streamAuth.generateSignedUrl(trackId, base, 7200);
  const mimeType = trackMimeType(track?.format);
  const coverBase = albumInfo?.coverArt
    ? (albumInfo.coverArt.startsWith('http') ? albumInfo.coverArt : `${base}${albumInfo.coverArt}`)
    : '';
  return {
    streamUrl,
    mimeType,
    metadata: {
      title: track?.title || 'Unknown',
      artist: track?.artist || albumInfo?.artist || 'Unknown',
      creator: track?.artist || albumInfo?.artist || 'Unknown',
      album: track?.album || albumInfo?.album || '',
      albumArtURI: coverBase,
      contentType: mimeType,
      itemId: trackId,
      type: 'audio',
      protocolInfo: `http-get:*:${mimeType}:*`,
    },
    track,
  };
}

// ── POST /api/cast/play — library track ───────────────────────────────────────

router.post('/cast/play', async (req, res) => {
  const { deviceUsn, trackId, albumInfo, queue, startPosition } = req.body;
  if (!deviceUsn || !trackId) return res.status(400).json({ error: 'Missing deviceUsn or trackId' });

  const info = _buildTrackCastInfo(trackId, albumInfo);
  if (!info) return res.status(404).json({ error: 'Track not found' });

  const deviceType = dlna.getDeviceType(deviceUsn);
  const _dev = dlna.getDevices().find(d => d.usn === deviceUsn);
  const deviceName = _dev?.roomName || _dev?.friendlyName || deviceUsn;
  const userId = req.userId || 'default';

  try {
    log(`play: "${info.metadata.title}" by ${info.metadata.artist} → ${deviceName} [${deviceType}]`);

    if (deviceType === 'sonos' && queue && queue.length > 0) {
      // Sonos: use AddURIToQueue for full queue support
      const startIdx = queue.findIndex(q => q.id === trackId);
      const existingSession = castSession.getSession(userId);
      const newHash = castSession.computeQueueHash(queue);

      if (existingSession?.queueHash === newHash && existingSession.deviceUsn === deviceUsn) {
        // Same queue, same device — just jump to the track
        log(`play: queue unchanged (hash=${newHash.slice(0, 8)}), jumping to index ${startIdx}`);
        await dlna.sonosPlayFromQueue(deviceUsn, Math.max(0, startIdx) + 1); // 1-based
        if (startPosition && startPosition > 2) {
          await new Promise(r => setTimeout(r, 800));
          try { await dlna.seek(deviceUsn, startPosition); } catch (_) {}
        }
      } else {
        // Different queue — full reload
        const queueTracks = [];
        for (const q of queue) {
          if (q.isYt) {
            const base = getLanBase();
            const ytUrl = streamAuth.generateSignedYtUrl(q.ytVideoId, base, 7200);
            queueTracks.push({
              streamUrl: ytUrl,
              metadata: { title: q.title || 'Unknown', artist: q.artist || 'Unknown', album: '', albumArtURI: '', contentType: 'audio/mpeg', itemId: q.id },
            });
          } else {
            const tInfo = _buildTrackCastInfo(q.id, albumInfo);
            if (tInfo) queueTracks.push({ streamUrl: tInfo.streamUrl, metadata: tInfo.metadata });
          }
        }

        await dlna.sonosPlayQueue(deviceUsn, queueTracks, Math.max(0, startIdx), startPosition);
        log(`play: Sonos queue loaded with ${queueTracks.length} tracks, starting at index ${startIdx}`);
      }
    } else if (deviceType === 'wiim' && queue && queue.length > 0) {
      // WiiM: use Linkplay PlayQueue
      const startIdx = queue.findIndex(q => q.id === trackId);
      const existingSession = castSession.getSession(userId);
      const newHash = castSession.computeQueueHash(queue);

      if (existingSession?.queueHash === newHash && existingSession.deviceUsn === deviceUsn) {
        log(`play: WiiM queue unchanged, jumping to index ${startIdx}`);
        await dlna.wiimPlayQueueWithIndex(deviceUsn, Math.max(0, startIdx));
        if (startPosition && startPosition > 2) {
          await new Promise(r => setTimeout(r, 800));
          try { await dlna.seek(deviceUsn, startPosition); } catch (_) {}
        }
      } else {
        const queueTracks = [];
        for (const q of queue) {
          if (q.isYt) {
            const base = getLanBase();
            const ytUrl = streamAuth.generateSignedYtUrl(q.ytVideoId, base, 7200);
            queueTracks.push({
              streamUrl: ytUrl,
              metadata: { title: q.title || 'Unknown', artist: q.artist || 'Unknown', album: '', albumArtURI: '', contentType: 'audio/mpeg', itemId: q.id },
            });
          } else {
            const tInfo = _buildTrackCastInfo(q.id, albumInfo);
            if (tInfo) queueTracks.push({ streamUrl: tInfo.streamUrl, metadata: tInfo.metadata });
          }
        }
        await dlna.wiimPlayQueue(deviceUsn, queueTracks, Math.max(0, startIdx), startPosition);
        log(`play: WiiM queue loaded with ${queueTracks.length} tracks, starting at index ${startIdx}`);
      }
    } else {
      // Generic: single-track SetAVTransportURI
      await dlna.play(deviceUsn, info.streamUrl, { metadata: info.metadata, contentType: info.mimeType }, startPosition);

      // Gapless: pre-buffer next track for generic devices
      if (queue && queue.length > 1) {
        const currentIdx = queue.findIndex(q => q.id === trackId);
        const nextIdx = currentIdx + 1;
        if (nextIdx < queue.length) {
          const nextTrack = queue[nextIdx];
          const nextInfo = nextTrack.isYt ? null : _buildTrackCastInfo(nextTrack.id, albumInfo);
          if (nextInfo) {
            dlna.setNextTrack(deviceUsn, nextInfo.streamUrl, nextInfo.metadata).catch(() => {});
          }
        }
      }
    }

    castSession.setSession(userId, {
      deviceUsn,
      deviceType,
      queue: queue || [{ id: trackId, title: info.track?.title, artist: info.track?.artist }],
      queueIndex: queue ? Math.max(0, queue.findIndex(q => q.id === trackId)) : 0,
    });
    log('play: success');
    res.json({ status: 'playing', device: deviceName, deviceType });
  } catch (err) {
    log(`play: FAILED — ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/cast/play/yt — YouTube track ────────────────────────────────────

router.post('/cast/play/yt', async (req, res) => {
  const { deviceUsn, videoId, title, artist, album, coverArt } = req.body;
  if (!deviceUsn || !videoId) return res.status(400).json({ error: 'Missing deviceUsn or videoId' });

  const base = getLanBase();
  const streamUrl = streamAuth.generateSignedYtUrl(videoId, base, 7200);

  const metadata = {
    title: title || 'Unknown',
    artist: artist || 'Unknown',
    creator: artist || 'Unknown',
    album: album || '',
    albumArtURI: coverArt || '',
    type: 'audio',
    protocolInfo: 'http-get:*:audio/mpeg:*',
  };

  try {
    const _ytDev = dlna.getDevices().find(d => d.usn === deviceUsn);
    log(`play/yt: "${title}" by ${artist} → ${_ytDev?.roomName || _ytDev?.friendlyName || deviceUsn}`);
    log(`play/yt: streamUrl=${streamUrl}`);
    await dlna.play(deviceUsn, streamUrl, { metadata, contentType: 'audio/mpeg' });
    const userId = req.userId || 'default';
    castSession.setSession(userId, {
      deviceUsn,
      queue: [{ id: `yt-${videoId}`, title, artist, isYt: true, ytVideoId: videoId }],
      queueIndex: 0,
    });
    const device = dlna.getDevices().find(d => d.usn === deviceUsn);
    log('play/yt: success');
    res.json({ status: 'playing', device: device?.roomName || device?.friendlyName || deviceUsn });
  } catch (err) {
    log(`play/yt: FAILED — ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/cast/pause ──────────────────────────────────────────────────────

router.post('/cast/pause', async (req, res) => {
  const { deviceUsn } = req.body;
  if (!deviceUsn) return res.status(400).json({ error: 'Missing deviceUsn' });
  try {
    const state = await dlna.getTransportState(deviceUsn);
    if (state === 'PLAYING') {
      await dlna.pause(deviceUsn);
      res.json({ status: 'paused' });
    } else {
      // Resume from paused/stopped — just send Play
      await dlna.resume(deviceUsn);
      res.json({ status: 'playing' });
    }
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

  // Subscribe to UPnP events for this device
  try { await dlna.subscribe(deviceUsn); } catch (err) { log(`SSE: subscribe failed: ${err.message}`); }

  const onDeviceLost = ({ usn }) => {
    if (usn === deviceUsn) send({ event: 'deviceLost', deviceUsn });
  };
  dlna.on('deviceLost', onDeviceLost);

  // Forward event-driven state changes instantly
  let lastState = null;
  let lastVolume = null;
  let lastTrackURI = null;

  const onTransportState = ({ deviceUsn: usn, state }) => {
    if (usn !== deviceUsn) return;
    lastState = state;
  };
  const onVolumeChanged = ({ deviceUsn: usn, volume }) => {
    if (usn !== deviceUsn) return;
    lastVolume = volume;
  };
  const onTrackChanged = ({ deviceUsn: usn, trackURI }) => {
    if (usn !== deviceUsn) return;
    // Sync session queue index
    const session = castSession.getSession(userId);
    if (session) {
      const queue = session.queue || [];
      for (let i = 0; i < queue.length; i++) {
        if (queue[i].id && trackURI.includes(queue[i].id)) {
          if (i !== session.queueIndex) {
            log(`SSE: track changed externally to index ${i} ("${queue[i].title}")`);
            session.queueIndex = i;
          }
          break;
        }
      }
    }
  };

  dlna.on('transportStateChanged', onTransportState);
  dlna.on('volumeChanged', onVolumeChanged);
  dlna.on('trackChanged', onTrackChanged);

  // Cleanup all listeners, polling, and SSE connection
  let cleaned = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(safetyTimeout);
    clearInterval(poll);
    dlna.removeListener('deviceLost', onDeviceLost);
    dlna.removeListener('transportStateChanged', onTransportState);
    dlna.removeListener('volumeChanged', onVolumeChanged);
    dlna.removeListener('trackChanged', onTrackChanged);
    dlna.unsubscribe(deviceUsn).catch(() => {});
    if (!res.writableEnded) res.end();
  }

  // Safety: clean up after 30 minutes of inactivity
  const safetyTimeout = setTimeout(() => {
    log(`SSE: safety timeout reached for ${deviceUsn}, cleaning up`);
    cleanup();
  }, 30 * 60 * 1000);

  // Position-only polling (1 SOAP call/sec instead of 3)
  // Falls back to full polling if event subscription failed
  const poll = setInterval(async () => {
    try {
      const usingPolling = dlna.isUsingPolling(deviceUsn);
      const position = await dlna.getPosition(deviceUsn);

      let state, volume;
      if (usingPolling) {
        // Full polling fallback
        [state, volume] = await Promise.all([
          dlna.getTransportState(deviceUsn),
          dlna.getVolume(deviceUsn),
        ]);
        // Track change detection via polling
        if (position.trackURI && lastTrackURI && position.trackURI !== lastTrackURI) {
          onTrackChanged({ deviceUsn, trackURI: position.trackURI });
        }
        lastTrackURI = position.trackURI;
      } else {
        // Use event-driven state, only poll position
        state = lastState || (await dlna.getTransportState(deviceUsn));
        volume = lastVolume ?? (await dlna.getVolume(deviceUsn));
        // Still track URI for sync
        if (position.trackURI && lastTrackURI && position.trackURI !== lastTrackURI) {
          onTrackChanged({ deviceUsn, trackURI: position.trackURI });
        }
        lastTrackURI = position.trackURI;
      }

      send({ ...position, state, volume, currentTrack: castSession.currentTrack(userId) });
    } catch {
      send({ event: 'error', message: 'Failed to poll device' });
    }
  }, 1000);

  req.on('close', cleanup);
});

// ── POST /api/cast/next ───────────────────────────────────────────────────────

router.post('/cast/next', async (req, res) => {
  const userId = req.userId || 'default';
  const session = castSession.getSession(userId);
  if (!session) return res.status(400).json({ error: 'No active cast session' });

  const next = castSession.advanceQueue(userId);
  if (!next) return res.status(400).json({ error: 'No next track in queue' });

  try {
    if (session.deviceType === 'sonos') {
      const updatedSession = castSession.getSession(userId);
      await dlna.sonosPlayFromQueue(session.deviceUsn, updatedSession.queueIndex + 1);
      log(`next: Sonos skip to queue position ${updatedSession.queueIndex + 1}`);
    } else if (session.deviceType === 'wiim') {
      await dlna.transportNext(session.deviceUsn);
      log(`next: WiiM AVTransport Next`);
    } else {
      const base = getLanBase();
      if (next.isYt) {
        const streamUrl = streamAuth.generateSignedYtUrl(next.ytVideoId, base, 7200);
        const metadata = { title: next.title, artist: next.artist, creator: next.artist, album: '', type: 'audio', protocolInfo: 'http-get:*:audio/mpeg:*' };
        await dlna.play(session.deviceUsn, streamUrl, { metadata, contentType: 'audio/mpeg' });
      } else {
        const info = _buildTrackCastInfo(next.id, {});
        if (info) await dlna.play(session.deviceUsn, info.streamUrl, { metadata: info.metadata, contentType: info.mimeType });
      }
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

  try {
    if (session.deviceType === 'sonos') {
      const updatedSession = castSession.getSession(userId);
      await dlna.sonosPlayFromQueue(session.deviceUsn, updatedSession.queueIndex + 1);
      log(`prev: Sonos skip to queue position ${updatedSession.queueIndex + 1}`);
    } else if (session.deviceType === 'wiim') {
      await dlna.transportPrevious(session.deviceUsn);
      log(`prev: WiiM AVTransport Previous`);
    } else {
      const base = getLanBase();
      if (prev.isYt) {
        const streamUrl = streamAuth.generateSignedYtUrl(prev.ytVideoId, base, 7200);
        const metadata = { title: prev.title, artist: prev.artist, creator: prev.artist, album: '', type: 'audio', protocolInfo: 'http-get:*:audio/mpeg:*' };
        await dlna.play(session.deviceUsn, streamUrl, { metadata, contentType: 'audio/mpeg' });
      } else {
        const info = _buildTrackCastInfo(prev.id, {});
        if (info) await dlna.play(session.deviceUsn, info.streamUrl, { metadata: info.metadata, contentType: info.mimeType });
      }
    }
    res.json({ status: 'playing', track: prev });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
