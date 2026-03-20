/**
 * Activity log — ring buffer of download/pipeline events for the UI.
 * Stores the last N events in memory, queryable via API and SSE stream.
 */

const EventEmitter = require('events');
const emitter = new EventEmitter();
emitter.setMaxListeners(20);

const MAX_ENTRIES = 200;
const entries = [];

/**
 * Log levels: info, warn, error, success
 * Categories: download, upgrade, youtube, torrent, pipeline, library
 */
function log(category, level, message, meta = {}) {
  const entry = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    ts: Date.now(),
    category,
    level,
    message,
    ...meta,
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();

  // Emit for SSE listeners
  emitter.emit('entry', entry);

  // Also log to console for docker logs visibility
  const prefix = `[activity][${category}]`;
  if (level === 'error') console.error(prefix, message, meta.error || '');
  else if (level === 'warn') console.warn(prefix, message);
  else console.log(prefix, message);

  return entry;
}

function getEntries({ since, category, limit = 100 } = {}) {
  let result = entries;
  if (since) result = result.filter(e => e.ts > since);
  if (category) result = result.filter(e => e.category === category);
  return result.slice(-limit);
}

function onEntry(listener) {
  emitter.on('entry', listener);
  return () => emitter.off('entry', listener);
}

function clear() {
  entries.length = 0;
}

module.exports = { log, getEntries, onEntry, clear };
