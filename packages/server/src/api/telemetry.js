'use strict';

/**
 * Telemetry API — collects client playback events, stores in ring buffer,
 * and streams via SSE for real-time monitoring.
 *
 * Uses the same EventEmitter pattern as services/activity-log.js.
 */

const express = require('express');
const EventEmitter = require('events');

const router = express.Router();
const emitter = new EventEmitter();
emitter.setMaxListeners(20);

const MAX_ENTRIES = 500;
const entries = [];

// Significant event types that warrant console logging
const SIGNIFICANT_EVENTS = new Set([
  'playback_error', 'stall', 'buffer_underrun', 'decode_error',
  'stream_error', 'anomaly', 'timeout',
]);

/**
 * Ingest a single telemetry event into the ring buffer and emit for SSE.
 */
function ingest(event) {
  const entry = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    ts: event.timestamp || Date.now(),
    traceId: event.traceId || null,
    event: event.event,
    trackId: event.trackId || null,
    latencyMs: event.latencyMs || null,
    detail: event.detail || null,
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();

  emitter.emit('event', entry);

  // Log significant events to console for docker logs visibility
  if (SIGNIFICANT_EVENTS.has(entry.event)) {
    console.warn(`[telemetry] ${entry.event}`, entry.traceId || '', entry.detail || '');
  }

  return entry;
}

/**
 * POST /  — accept array of client telemetry events
 */
router.post('/', (req, res) => {
  const { events: clientEvents } = req.body || {};
  if (!Array.isArray(clientEvents) || clientEvents.length === 0) {
    return res.status(400).json({ error: 'Expected non-empty events array' });
  }

  for (const ev of clientEvents) {
    if (!ev.event) continue; // skip malformed entries
    ingest(ev);
  }

  res.status(204).end();
});

/**
 * GET / — return recent telemetry entries (last 100 by default)
 * Query params: ?traceId=xxx  ?event=xxx
 */
router.get('/', (req, res) => {
  const { traceId, event } = req.query;
  let result = entries;
  if (traceId) result = result.filter(e => e.traceId === traceId);
  if (event) result = result.filter(e => e.event === event);
  res.json(result.slice(-100));
});

/**
 * GET /stream — SSE stream of all telemetry events
 */
const sseClients = new Set();

router.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write(':\n\n'); // SSE comment as initial keepalive

  sseClients.add(res);

  const onEvent = (entry) => {
    try { res.write(`data: ${JSON.stringify(entry)}\n\n`); } catch {}
  };
  emitter.on('event', onEvent);

  // Heartbeat every 15 seconds
  const heartbeat = setInterval(() => {
    try { res.write(':\n\n'); } catch {}
  }, 15000);

  req.on('close', () => {
    emitter.off('event', onEvent);
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// Expose internals for testing
module.exports = router;
module.exports._test = { entries, emitter, ingest, sseClients };
