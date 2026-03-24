const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { performance } = require('perf_hooks');

const CONFIG_DIR = process.env.CONFIG_DIR || '/app/config';
const DB_PATH = path.join(CONFIG_DIR, 'notify.db');

let _db = null;

function getDb() {
  if (_db) return _db;

  fs.mkdirSync(CONFIG_DIR, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  // Create tables
  _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT NOT NULL REFERENCES users(id),
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (user_id, key)
    );

    CREATE TABLE IF NOT EXISTS lastfm_config (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      api_key TEXT,
      api_secret TEXT,
      session_key TEXT,
      username TEXT
    );

    CREATE TABLE IF NOT EXISTS recently_played (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id),
      artist TEXT NOT NULL,
      album TEXT NOT NULL,
      cover_art TEXT,
      mbid TEXT,
      rgid TEXT,
      played_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS search_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id),
      query TEXT NOT NULL,
      searched_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id),
      track_id TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT NOT NULL,
      title TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      UNIQUE(user_id, track_id)
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlist_tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      track_id TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT NOT NULL,
      title TEXT NOT NULL,
      position INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_session (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      queue TEXT NOT NULL DEFAULT '[]',
      state TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS lastfm_scrobble_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id),
      artist TEXT NOT NULL,
      track TEXT NOT NULL,
      album TEXT,
      timestamp INTEGER NOT NULL,
      duration INTEGER
    );

    CREATE TABLE IF NOT EXISTS global_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS job_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER,
      artist TEXT,
      album TEXT,
      attempt INTEGER,
      duration_ms INTEGER,
      outcome TEXT,
      fail_reason TEXT,
      quality TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS scrobbles (
      user_id TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT,
      track TEXT NOT NULL,
      played_at INTEGER NOT NULL,
      UNIQUE(user_id, artist, track, played_at)
    );

    CREATE TABLE IF NOT EXISTS artist_affinity (
      user_id TEXT NOT NULL,
      artist TEXT NOT NULL,
      play_count INTEGER NOT NULL,
      last_played_at INTEGER NOT NULL,
      PRIMARY KEY(user_id, artist)
    );

    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      artist TEXT NOT NULL,
      album TEXT NOT NULL,
      title TEXT NOT NULL,
      track_number INTEGER,
      format TEXT NOT NULL,
      filepath TEXT NOT NULL UNIQUE,
      file_size INTEGER,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS mb_cache (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      hit_count INTEGER DEFAULT 0
    );
  `);

  // Create indexes
  _db.exec(`
    CREATE INDEX IF NOT EXISTS idx_rp_user_time ON recently_played(user_id, played_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sh_user_time ON search_history(user_id, searched_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pt_playlist ON playlist_tracks(playlist_id, position);
    CREATE INDEX IF NOT EXISTS idx_scrobbles_user_artist ON scrobbles(user_id, artist);
    CREATE INDEX IF NOT EXISTS idx_scrobbles_user_time ON scrobbles(user_id, played_at);
    CREATE INDEX IF NOT EXISTS idx_tracks_artist_album ON tracks(artist, album);
    CREATE INDEX IF NOT EXISTS idx_mb_cache_expires ON mb_cache(expires_at);
  `);

  // Migration: add role column if missing
  try {
    _db.prepare("SELECT role FROM users LIMIT 1").get();
  } catch {
    _db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
  }

  return _db;
}

// --- Timed Executors ---
let _log = null;
function getLog() {
  if (!_log) {
    try { _log = require('./logger').createChild('db'); } catch { _log = { warn() {} }; }
  }
  return _log;
}

const SLOW_QUERY_MS = 100;

function timedRun(sql, ...params) {
  const start = performance.now();
  const result = getDb().prepare(sql).run(...params);
  const duration = performance.now() - start;
  if (duration > SLOW_QUERY_MS) {
    getLog().warn({ event: 'db.query.slow', duration: Math.round(duration), sql }, 'Slow query');
  }
  return result;
}

function timedGet(sql, ...params) {
  const start = performance.now();
  const result = getDb().prepare(sql).get(...params);
  const duration = performance.now() - start;
  if (duration > SLOW_QUERY_MS) {
    getLog().warn({ event: 'db.query.slow', duration: Math.round(duration), sql }, 'Slow query');
  }
  return result;
}

function timedAll(sql, ...params) {
  const start = performance.now();
  const result = getDb().prepare(sql).all(...params);
  const duration = performance.now() - start;
  if (duration > SLOW_QUERY_MS) {
    getLog().warn({ event: 'db.query.slow', duration: Math.round(duration), sql }, 'Slow query');
  }
  return result;
}

// --- Recently Played ---

const MAX_RP = 50;

function getRecentlyPlayed(userId) {
  return timedAll(
    'SELECT artist, album, cover_art as coverArt, mbid, rgid, played_at as playedAt FROM recently_played WHERE user_id = ? ORDER BY played_at DESC LIMIT ?',
    userId, MAX_RP
  );
}

function addRecentlyPlayed(userId, { artist, album, coverArt, mbid, rgid }) {
  const now = Date.now();
  // Remove existing entry for same album (dedup)
  timedRun(
    'DELETE FROM recently_played WHERE user_id = ? AND LOWER(artist || \':\' || album) = LOWER(? || \':\' || ?)',
    userId, artist, album
  );
  // Insert new
  timedRun(
    'INSERT INTO recently_played (user_id, artist, album, cover_art, mbid, rgid, played_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    userId, artist, album, coverArt || null, mbid || null, rgid || null, now
  );
  // Trim to MAX_RP
  timedRun(
    'DELETE FROM recently_played WHERE user_id = ? AND id NOT IN (SELECT id FROM recently_played WHERE user_id = ? ORDER BY played_at DESC LIMIT ?)',
    userId, userId, MAX_RP
  );
  return getRecentlyPlayed(userId);
}

function bulkSetRecentlyPlayed(userId, list) {
  const db = getDb();
  const del = db.prepare('DELETE FROM recently_played WHERE user_id = ?');
  const ins = db.prepare(
    'INSERT INTO recently_played (user_id, artist, album, cover_art, mbid, rgid, played_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const tx = db.transaction(() => {
    del.run(userId);
    for (const r of list.slice(0, MAX_RP)) {
      ins.run(userId, r.artist, r.album, r.coverArt || r.cover_art || null, r.mbid || null, r.rgid || null, r.playedAt || r.played_at || Date.now());
    }
  });
  const start = performance.now();
  tx();
  const duration = performance.now() - start;
  if (duration > SLOW_QUERY_MS) {
    getLog().warn({ event: 'db.query.slow', duration: Math.round(duration), operation: 'bulkSetRecentlyPlayed (transaction)', rows: list.length }, 'Slow transaction');
  }
  return getRecentlyPlayed(userId);
}

// --- Last.fm Config ---

function getLastfmConfig(userId) {
  const row = timedGet('SELECT * FROM lastfm_config WHERE user_id = ?', userId);
  if (!row) return {};
  return {
    apiKey: row.api_key,
    apiSecret: row.api_secret,
    sessionKey: row.session_key,
    username: row.username,
  };
}

function saveLastfmConfig(userId, updates) {
  const existing = getLastfmConfig(userId);
  const merged = { ...existing, ...updates };
  timedRun(`
    INSERT INTO lastfm_config (user_id, api_key, api_secret, session_key, username)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      api_key = excluded.api_key,
      api_secret = excluded.api_secret,
      session_key = excluded.session_key,
      username = excluded.username
  `, userId, merged.apiKey || null, merged.apiSecret || null, merged.sessionKey || null, merged.username || null);
}

function clearLastfmConfig(userId) {
  timedRun('DELETE FROM lastfm_config WHERE user_id = ?', userId);
}

// --- Last.fm Scrobble Queue ---

function getScrobbleQueue(userId) {
  return timedAll('SELECT * FROM lastfm_scrobble_queue WHERE user_id = ? ORDER BY timestamp', userId);
}

function addToScrobbleQueue(userId, { artist, track, album, timestamp, duration }) {
  timedRun(
    'INSERT INTO lastfm_scrobble_queue (user_id, artist, track, album, timestamp, duration) VALUES (?, ?, ?, ?, ?, ?)',
    userId, artist, track, album || null, timestamp, duration || null
  );
}

function removeFromScrobbleQueue(ids) {
  if (!ids.length) return;
  const placeholders = ids.map(() => '?').join(',');
  const sql = `DELETE FROM lastfm_scrobble_queue WHERE id IN (${placeholders})`;
  const start = performance.now();
  getDb().prepare(sql).run(...ids);
  const duration = performance.now() - start;
  if (duration > SLOW_QUERY_MS) {
    getLog().warn({ event: 'db.query.slow', duration: Math.round(duration), sql }, 'Slow query');
  }
}

function getAllUsersWithScrobbleQueue() {
  return timedAll('SELECT DISTINCT user_id FROM lastfm_scrobble_queue').map(r => r.user_id);
}

// --- Global Settings ---

function getGlobalSetting(key) {
  const row = timedGet('SELECT value FROM global_settings WHERE key = ?', key);
  return row ? JSON.parse(row.value) : null;
}

function setGlobalSetting(key, value) {
  timedRun('INSERT OR REPLACE INTO global_settings (key, value) VALUES (?, ?)', key, JSON.stringify(value));
}

// --- User Settings ---

function getUserSetting(userId, key) {
  const row = timedGet('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', userId, key);
  return row ? JSON.parse(row.value) : null;
}

function setUserSetting(userId, key, value) {
  timedRun('INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)', userId, key, JSON.stringify(value));
}

function getAllUserSettings(userId) {
  const rows = timedAll('SELECT key, value FROM user_settings WHERE user_id = ?', userId);
  const settings = {};
  for (const r of rows) {
    settings[r.key] = JSON.parse(r.value);
  }
  return settings;
}

// --- Search History ---

const MAX_SEARCH_HISTORY = 20;

function getSearchHistory(userId) {
  return timedAll(
    'SELECT query, searched_at as searchedAt FROM search_history WHERE user_id = ? ORDER BY searched_at DESC LIMIT ?',
    userId, MAX_SEARCH_HISTORY
  );
}

function addSearchHistory(userId, query) {
  // Remove duplicate
  timedRun('DELETE FROM search_history WHERE user_id = ? AND LOWER(query) = LOWER(?)', userId, query);
  timedRun('INSERT INTO search_history (user_id, query, searched_at) VALUES (?, ?, ?)', userId, query, Date.now());
  // Trim
  timedRun(
    'DELETE FROM search_history WHERE user_id = ? AND id NOT IN (SELECT id FROM search_history WHERE user_id = ? ORDER BY searched_at DESC LIMIT ?)',
    userId, userId, MAX_SEARCH_HISTORY
  );
}

function removeSearchHistory(userId, query) {
  timedRun('DELETE FROM search_history WHERE user_id = ? AND query = ?', userId, query);
}

function clearSearchHistory(userId) {
  timedRun('DELETE FROM search_history WHERE user_id = ?', userId);
}

// --- Favorites ---

function getFavorites(userId) {
  return timedAll(
    'SELECT track_id as trackId, artist, album, title, added_at as addedAt FROM favorites WHERE user_id = ? ORDER BY added_at DESC',
    userId
  );
}

function addFavorite(userId, { trackId, artist, album, title }) {
  timedRun(
    'INSERT OR IGNORE INTO favorites (user_id, track_id, artist, album, title, added_at) VALUES (?, ?, ?, ?, ?, ?)',
    userId, trackId, artist, album, title, Date.now()
  );
}

function removeFavorite(userId, trackId) {
  timedRun('DELETE FROM favorites WHERE user_id = ? AND track_id = ?', userId, trackId);
}

function isFavorite(userId, trackId) {
  return !!timedGet('SELECT 1 FROM favorites WHERE user_id = ? AND track_id = ?', userId, trackId);
}

// --- User Session ---

function getUserSession(userId) {
  const row = timedGet('SELECT queue, state FROM user_session WHERE user_id = ?', userId);
  if (!row) return { queue: [], state: {} };
  return {
    queue: JSON.parse(row.queue),
    state: JSON.parse(row.state),
  };
}

function saveUserSession(userId, { queue, state }) {
  timedRun(`
    INSERT INTO user_session (user_id, queue, state)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      queue = excluded.queue,
      state = excluded.state
  `, userId, JSON.stringify(queue || []), JSON.stringify(state || {}));
}

// --- Users ---

function getUsers() {
  return timedAll("SELECT id, display_name as displayName, role FROM users WHERE id != 'default' ORDER BY display_name");
}

function isAdmin(userId) {
  const row = timedGet("SELECT role FROM users WHERE id = ?", userId);
  return row?.role === 'admin';
}

function isValidUser(userId) {
  return !!timedGet('SELECT 1 FROM users WHERE id = ?', userId);
}

function createUser(id, displayName, role = 'user') {
  timedRun('INSERT INTO users (id, display_name, role) VALUES (?, ?, ?)', id, displayName, role);
  return { id, displayName, role };
}

function getUserCount() {
  return timedGet("SELECT COUNT(*) as count FROM users WHERE id != 'default'").count;
}

function getDefaultUserId() {
  const row = timedGet("SELECT id FROM users WHERE id != 'default' ORDER BY created_at ASC LIMIT 1");
  return row?.id || null;
}

function isSetupComplete() {
  try {
    const flag = timedGet("SELECT value FROM global_settings WHERE key = 'setup_complete'");
    if (flag && JSON.parse(flag.value) === true) return true;
    return getUserCount() > 0;
  } catch {
    return false;
  }
}

// --- Job Log ---

function addJobLog(entry) {
  timedRun(`INSERT INTO job_log (job_id, artist, album, attempt, duration_ms, outcome, fail_reason, quality)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    entry.job_id, entry.artist, entry.album, entry.attempt,
    entry.duration_ms, entry.outcome, entry.fail_reason || null, entry.quality || null
  );
}

function getJobLogs(limit = 100) {
  return timedAll(`SELECT * FROM job_log ORDER BY created_at DESC LIMIT ?`, limit);
}

// --- Scrobbles ---

function insertScrobbles(userId, scrobbles) {
  const db = getDb();
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO scrobbles (user_id, artist, album, track, played_at) VALUES (?, ?, ?, ?, ?)'
  );
  const tx = db.transaction(() => {
    for (const s of scrobbles) {
      stmt.run(userId, s.artist, s.album || '', s.track, s.played_at);
    }
  });
  const start = performance.now();
  tx();
  const duration = performance.now() - start;
  if (duration > SLOW_QUERY_MS) {
    getLog().warn({ event: 'db.query.slow', duration: Math.round(duration), operation: 'insertScrobbles (transaction)', rows: scrobbles.length }, 'Slow transaction');
  }
}

function getScrobbleCount(userId) {
  return timedGet('SELECT COUNT(*) as count FROM scrobbles WHERE user_id = ?', userId).count;
}

function getLatestScrobbleTime(userId) {
  const row = timedGet('SELECT MAX(played_at) as latest FROM scrobbles WHERE user_id = ?', userId);
  return row?.latest || 0;
}

function rebuildArtistAffinity(userId) {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM artist_affinity WHERE user_id = ?').run(userId);
    db.prepare(`
      INSERT INTO artist_affinity (user_id, artist, play_count, last_played_at)
      SELECT user_id, artist, COUNT(*) as play_count, MAX(played_at) as last_played_at
      FROM scrobbles WHERE user_id = ? GROUP BY user_id, artist
    `).run(userId);
  });
  const start = performance.now();
  tx();
  const duration = performance.now() - start;
  if (duration > SLOW_QUERY_MS) {
    getLog().warn({ event: 'db.query.slow', duration: Math.round(duration), operation: 'rebuildArtistAffinity (transaction)' }, 'Slow transaction');
  }
}

function getArtistAffinity(userId) {
  return timedAll('SELECT * FROM artist_affinity WHERE user_id = ? ORDER BY play_count DESC', userId);
}

function getUniqueAlbumsSince(userId, days) {
  const since = Math.floor(Date.now() / 1000) - (days * 86400);
  return timedAll(`
    SELECT DISTINCT artist, album FROM scrobbles
    WHERE user_id = ? AND played_at >= ? AND album != ''
    ORDER BY artist, album
  `, userId, since);
}

function searchArtistAffinity(userId, query) {
  const pattern = '%' + query + '%';
  return timedAll(`
    SELECT * FROM artist_affinity
    WHERE user_id = ? AND artist LIKE ? AND play_count >= 2
    ORDER BY play_count DESC LIMIT 3
  `, userId, pattern);
}

// Returns the top artists blending all-time affinity with recent listening.
// Recent scrobbles (last 30 days) get 3x weight to surface current interests.
// Used for pre-warming the MB cache on startup.
function getTopArtists(limit = 30) {
  const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
  return timedAll(`
    SELECT name, SUM(score) as play_count FROM (
      SELECT artist as name, SUM(play_count) as score
      FROM artist_affinity
      GROUP BY artist
      UNION ALL
      SELECT artist as name, COUNT(*) * 3 as score
      FROM scrobbles
      WHERE played_at > ?
      GROUP BY artist
    )
    GROUP BY name
    ORDER BY play_count DESC
    LIMIT ?
  `, thirtyDaysAgo, limit);
}

// --- Tracks ---

function upsertTrack({ id, artist, album, title, trackNumber, format, filepath, fileSize }) {
  // Delete any existing track with the same filepath but different id
  // (happens when track ID generation changes across versions)
  timedRun('DELETE FROM tracks WHERE filepath = ? AND id != ?', filepath, id);
  return timedRun(`
    INSERT INTO tracks (id, artist, album, title, track_number, format, filepath, file_size, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(id) DO UPDATE SET
      format = excluded.format,
      filepath = excluded.filepath,
      file_size = excluded.file_size,
      track_number = excluded.track_number,
      updated_at = unixepoch()
  `, id, artist, album, title, trackNumber || null, format, filepath, fileSize || null);
}

function getTrackById(id) {
  return timedGet('SELECT * FROM tracks WHERE id = ?', id);
}

function getAllTracks() {
  return timedAll('SELECT * FROM tracks ORDER BY artist, album, track_number, title');
}

function getTracksByAlbum(artist, album) {
  return timedAll('SELECT * FROM tracks WHERE artist = ? AND album = ? ORDER BY track_number, title', artist, album);
}

function removeTrackByFilepath(filepath) {
  return timedRun('DELETE FROM tracks WHERE filepath = ?', filepath);
}

function removeTrackById(id) {
  return timedRun('DELETE FROM tracks WHERE id = ?', id);
}

/**
 * Sync tracks for an album: upsert provided tracks, remove any that no longer exist.
 * Runs in a transaction for atomicity.
 */
function syncAlbumTracks(artist, album, tracksArray) {
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO tracks (id, artist, album, title, track_number, format, filepath, file_size, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(id) DO UPDATE SET
      format = excluded.format,
      filepath = excluded.filepath,
      file_size = excluded.file_size,
      track_number = excluded.track_number,
      updated_at = unixepoch()
  `);
  const filepaths = tracksArray.map(t => t.filepath);

  const tx = db.transaction(() => {
    for (const t of tracksArray) {
      upsert.run(t.id, t.artist, t.album, t.title, t.trackNumber || null, t.format, t.filepath, t.fileSize || null);
    }
    // Remove tracks for this artist+album that are no longer on disk
    if (filepaths.length > 0) {
      const placeholders = filepaths.map(() => '?').join(',');
      db.prepare(`DELETE FROM tracks WHERE artist = ? AND album = ? AND filepath NOT IN (${placeholders})`).run(artist, album, ...filepaths);
    } else {
      db.prepare('DELETE FROM tracks WHERE artist = ? AND album = ?').run(artist, album);
    }
  });
  const start = performance.now();
  tx();
  const duration = performance.now() - start;
  if (duration > SLOW_QUERY_MS) {
    getLog().warn({ event: 'db.query.slow', duration: Math.round(duration), operation: 'syncAlbumTracks (transaction)', rows: tracksArray.length }, 'Slow transaction');
  }
}

/**
 * Remove all tracks whose filepath is not in the provided set.
 * Used by full library scan to prune deleted files.
 */
function pruneDeletedTracks(validFilepaths) {
  if (validFilepaths.size === 0) {
    timedRun('DELETE FROM tracks');
    return;
  }
  // SQLite has a variable limit, batch deletes
  const all = timedAll('SELECT id, filepath FROM tracks');
  const toDelete = all.filter(t => !validFilepaths.has(t.filepath));
  if (toDelete.length === 0) return;
  const del = getDb().prepare('DELETE FROM tracks WHERE id = ?');
  const tx = getDb().transaction(() => {
    for (const t of toDelete) del.run(t.id);
  });
  const start = performance.now();
  tx();
  const duration = performance.now() - start;
  if (duration > SLOW_QUERY_MS) {
    getLog().warn({ event: 'db.query.slow', duration: Math.round(duration), operation: 'pruneDeletedTracks (transaction)', rows: toDelete.length }, 'Slow transaction');
  }
}

// --- MB Cache ---

function mbCacheGet(key) {
  try { getDb(); } catch { return null; }
  const row = timedGet('SELECT data, expires_at FROM mb_cache WHERE key = ?', key);
  if (!row) return null;
  if (Date.now() > row.expires_at) {
    timedRun('DELETE FROM mb_cache WHERE key = ?', key);
    return null;
  }
  timedRun('UPDATE mb_cache SET hit_count = hit_count + 1 WHERE key = ?', key);
  return JSON.parse(row.data);
}

function mbCacheSet(key, data, ttlMs) {
  const now = Date.now();
  timedRun(`INSERT OR REPLACE INTO mb_cache (key, data, expires_at, created_at, hit_count)
              VALUES (?, ?, ?, ?, 0)`, key, JSON.stringify(data), now + ttlMs, now);
}

function mbCacheCleanup() {
  const result = timedRun('DELETE FROM mb_cache WHERE expires_at < ?', Date.now());
  return result.changes;
}

function mbCacheStats() {
  return timedGet('SELECT COUNT(*) as total, SUM(hit_count) as hits FROM mb_cache');
}

// --- Diagnostics ---

function benchmark() {
  const start = performance.now();
  getDb().prepare('SELECT 1').get();
  const duration = Math.round((performance.now() - start) * 100) / 100;
  return { duration };
}

function getWalSize() {
  const walPath = path.join(CONFIG_DIR, 'notify.db-wal');
  try {
    const stat = fs.statSync(walPath);
    return stat.size;
  } catch {
    return 0;
  }
}

function checkpoint() {
  getDb().pragma('wal_checkpoint(TRUNCATE)');
}

function optimize() {
  getDb().pragma('optimize');
}

// --- Cleanup ---

function close() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

module.exports = {
  getDb,
  close,
  // Users
  getUsers,
  isValidUser,
  isAdmin,
  createUser,
  getUserCount,
  getDefaultUserId,
  isSetupComplete,
  // Recently played
  getRecentlyPlayed,
  addRecentlyPlayed,
  bulkSetRecentlyPlayed,
  // Last.fm config
  getLastfmConfig,
  saveLastfmConfig,
  clearLastfmConfig,
  // Last.fm scrobble queue
  getScrobbleQueue,
  addToScrobbleQueue,
  removeFromScrobbleQueue,
  getAllUsersWithScrobbleQueue,
  // Global settings
  getGlobalSetting,
  setGlobalSetting,
  // User settings
  getUserSetting,
  setUserSetting,
  getAllUserSettings,
  // Search history
  getSearchHistory,
  addSearchHistory,
  removeSearchHistory,
  clearSearchHistory,
  // Favorites
  getFavorites,
  addFavorite,
  removeFavorite,
  isFavorite,
  // Session
  getUserSession,
  saveUserSession,
  // Job log
  addJobLog,
  getJobLogs,
  // Scrobbles
  insertScrobbles,
  getScrobbleCount,
  getLatestScrobbleTime,
  rebuildArtistAffinity,
  getArtistAffinity,
  getUniqueAlbumsSince,
  searchArtistAffinity,
  getTopArtists,
  // Tracks
  upsertTrack,
  getTrackById,
  getAllTracks,
  getTracksByAlbum,
  removeTrackByFilepath,
  removeTrackById,
  syncAlbumTracks,
  pruneDeletedTracks,
  // MB Cache
  mbCacheGet,
  mbCacheSet,
  mbCacheCleanup,
  mbCacheStats,
  // Diagnostics
  benchmark,
  getWalSize,
  checkpoint,
  optimize,
};
