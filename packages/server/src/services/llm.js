/**
 * LLM Service — Ollama client with persistent cache, request queue, and graceful fallback.
 * All functions return null if the LLM is unavailable. Callers always have a non-LLM fallback.
 */

const fs = require('fs');
const path = require('path');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://ollama:11434';
const MODEL = process.env.LLM_MODEL || 'qwen3:4b';
const CONFIG_DIR = process.env.CONFIG_DIR || '/app/config';
const CACHE_PATH = path.join(CONFIG_DIR, 'llm-cache.json');
const TIMEOUT_MS = 60000; // 60s — CPU inference on 4B model can be slow

// --- Persistent cache ---

let diskCache = {};

function loadCache() {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      diskCache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    }
  } catch {
    diskCache = {};
  }
}

function saveCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(diskCache, null, 2));
  } catch (err) {
    console.error(`LLM cache save failed: ${err.message}`);
  }
}

function getCached(key) {
  const entry = diskCache[key];
  if (!entry) return null;
  // 7-day TTL for torrent parses (names don't change)
  if (Date.now() - entry.ts > 7 * 24 * 60 * 60 * 1000) {
    delete diskCache[key];
    return null;
  }
  return entry.data;
}

function setCached(key, data) {
  diskCache[key] = { data, ts: Date.now() };
  // Debounced save — batch writes
  clearTimeout(setCached._timer);
  setCached._timer = setTimeout(saveCache, 2000);
}

// --- Request queue (serialize LLM calls to avoid CPU overload) ---

let queue = Promise.resolve();

function enqueue(fn) {
  const p = queue.then(fn).catch(() => null);
  queue = p.then(() => {});
  return p;
}

// --- Health check ---

let healthy = null; // null = unknown, true/false
let lastHealthCheck = 0;

async function checkHealth() {
  if (Date.now() - lastHealthCheck < 30000) return healthy;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    healthy = res.ok;
  } catch {
    healthy = false;
  }
  lastHealthCheck = Date.now();
  return healthy;
}

// --- Model pull (ensure model is available) ---

let modelReady = false;

async function ensureModel() {
  if (modelReady) return true;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const data = await res.json();
    const models = (data.models || []).map(m => m.name);
    if (models.some(m => m.startsWith(MODEL.split(':')[0]))) {
      modelReady = true;
      return true;
    }
    // Pull the model
    console.log(`LLM: pulling model ${MODEL}...`);
    const pullRes = await fetch(`${OLLAMA_URL}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: MODEL, stream: false }),
      signal: AbortSignal.timeout(600000), // 10 min for download
    });
    modelReady = pullRes.ok;
    if (modelReady) console.log(`LLM: model ${MODEL} ready`);
    else console.error(`LLM: failed to pull model ${MODEL}`);
    return modelReady;
  } catch (err) {
    console.error(`LLM: model check failed: ${err.message}`);
    return false;
  }
}

// --- Core prompt function ---

async function prompt(text, schema) {
  if (!(await checkHealth())) return null;
  if (!(await ensureModel())) return null;

  const t0 = Date.now();
  try {
    const body = {
      model: MODEL,
      messages: [
        { role: 'user', content: text },
      ],
      stream: false,
      options: { temperature: 0.1, num_predict: 800 },
      think: false, // Ollama 0.7+ flag to suppress <think> blocks
    };
    if (schema) body.format = schema;

    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const content = data.message?.content;
    console.log(`LLM ok in ${Date.now() - t0}ms`);
    if (!content) return null;

    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  } catch (err) {
    console.error(`LLM prompt failed after ${Date.now() - t0}ms: ${err.name} ${err.message}`);
    return null;
  }
}

// --- Torrent name parsing ---

const TORRENT_PARSE_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          idx: { type: 'number' },
          artist: { type: 'string' },
          album: { type: 'string' },
          year: { type: 'string' },
          quality: { type: 'string' },
        },
        required: ['idx', 'artist', 'album'],
      },
    },
  },
  required: ['results'],
};

/**
 * Parse a batch of torrent names using the LLM.
 * Returns Map<name, { artist, album, year, quality }> for names it parsed.
 */
async function parseTorrentBatch(names) {
  if (!names.length) return new Map();

  const numbered = names.map((n, i) => `${i + 1}. "${n}"`).join('\n');
  const text = `You are a music torrent name parser. For each torrent name:
- Replace ALL underscores with spaces
- Remove scene/group tags (e.g. TosK, FTD, YIFY, eNJoY-iT, NoGroup)
- Remove quality labels (FLAC, MP3, 320, V0, ALAC, WEB)
- Remove year in parentheses or brackets
- Extract the real artist name and album title
- idx is the number before the period

Names:\n${numbered}`;

  const result = await enqueue(() => prompt(text, TORRENT_PARSE_SCHEMA));
  if (!result?.results) return new Map();

  const parsed = new Map();
  for (const r of result.results) {
    const idx = (r.idx || 0) - 1;
    if (idx >= 0 && idx < names.length && r.artist && r.album) {
      const entry = { artist: r.artist.trim(), album: r.album.trim(), year: (r.year || '').trim(), quality: (r.quality || '').trim() };
      parsed.set(names[idx], entry);
      setCached(`torrent:${names[idx]}`, entry);
    }
  }
  return parsed;
}

/**
 * Get cached LLM parse for a torrent name.
 */
function getCachedParse(name) {
  return getCached(`torrent:${name}`);
}

/**
 * Fire-and-forget: parse failed torrent names in background, populating cache.
 * Does not block the caller.
 */
function parseTorrentNamesAsync(names) {
  // Filter out already-cached names
  const uncached = names.filter(n => !getCached(`torrent:${n}`));
  if (!uncached.length) return;

  // Batch in groups of 10
  const batches = [];
  for (let i = 0; i < uncached.length; i += 10) {
    batches.push(uncached.slice(i, i + 10));
  }

  // Process sequentially (queued anyway), fire-and-forget
  (async () => {
    for (const batch of batches) {
      await parseTorrentBatch(batch);
    }
  })().catch(err => console.error(`LLM async parse error: ${err.message}`));
}

// --- Init ---

loadCache();

function getStatus() {
  return {
    healthy,
    modelReady,
    lastCheckAt: lastHealthCheck || null,
    cacheSize: Object.keys(diskCache).length,
    ollamaUrl: OLLAMA_URL,
    model: MODEL,
  };
}

module.exports = {
  prompt,
  parseTorrentBatch,
  parseTorrentNamesAsync,
  getCachedParse,
  checkHealth,
  getStatus,
};
