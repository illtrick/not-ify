const Database = require('better-sqlite3');
const path = require('path');

const CONFIG_DIR = process.env.CONFIG_DIR || '/app/config';
const DB_PATH = path.join(CONFIG_DIR, 'notify.db');

let _db = null;

function getDb() {
  if (_db) return _db;

  const fs = require('fs');
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
  // Auto-promote first user to admin if no admins exist
  const hasAdmin = _db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get();
  if (!hasAdmin) {
    _db.prepare("UPDATE users SET role = 'admin' WHERE id = (SELECT id FROM users WHERE id != 'default' ORDER BY created_at ASC LIMIT 1)").run();
  }

  // Seed default users if they don't exist
  const upsertUser = _db.prepare('INSERT OR IGNORE INTO users (id, display_name) VALUES (?, ?)');
  upsertUser.run('default', 'Default');
  upsertUser.run('nathan', 'Nathan');
  upsertUser.run('sarah', 'Sarah');

  return _db;
}

// --- Recently Played ---

const MAX_RP = 50;

function getRecentlyPlayed(userId) {
  const db = getDb();
  return db.prepare(
    'SELECT artist, album, cover_art as coverArt, mbid, rgid, played_at as playedAt FROM recently_played WHERE user_id = ? ORDER BY played_at DESC LIMIT ?'
  ).all(userId, MAX_RP);
}

function addRecentlyPlayed(userId, { artist, album, coverArt, mbid, rgid }) {
  const db = getDb();
  const now = Date.now();
  // Remove existing entry for same album (dedup)
  db.prepare(
    'DELETE FROM recently_played WHERE user_id = ? AND LOWER(artist || \':\' || album) = LOWER(? || \':\' || ?)'
  ).run(userId, artist, album);
  // Insert new
  db.prepare(
    'INSERT INTO recently_played (user_id, artist, album, cover_art, mbid, rgid, played_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(userId, artist, album, coverArt || null, mbid || null, rgid || null, now);
  // Trim to MAX_RP
  db.prepare(
    'DELETE FROM recently_played WHERE user_id = ? AND id NOT IN (SELECT id FROM recently_played WHERE user_id = ? ORDER BY played_at DESC LIMIT ?)'
  ).run(userId, userId, MAX_RP);
  return getRecentlyPlayed(userId);
}

function bulkSetRecentlyPlayed(userId, list) {
  const db = getDb();
  const del = db.prepare('DELETE FROM recently_played WHERE user_id = ?');
  const ins = db.prepare(
    'INSERT INTO recently_played (user_id, artist, album, cover_art, mbid, rgid, played_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  db.transaction(() => {
    del.run(userId);
    for (const r of list.slice(0, MAX_RP)) {
      ins.run(userId, r.artist, r.album, r.coverArt || r.cover_art || null, r.mbid || null, r.rgid || null, r.playedAt || r.played_at || Date.now());
    }
  })();
  return getRecentlyPlayed(userId);
}

// --- Last.fm Config ---

function getLastfmConfig(userId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM lastfm_config WHERE user_id = ?').get(userId);
  if (!row) return {};
  return {
    apiKey: row.api_key,
    apiSecret: row.api_secret,
    sessionKey: row.session_key,
    username: row.username,
  };
}

function saveLastfmConfig(userId, updates) {
  const db = getDb();
  const existing = getLastfmConfig(userId);
  const merged = { ...existing, ...updates };
  db.prepare(`
    INSERT INTO lastfm_config (user_id, api_key, api_secret, session_key, username)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      api_key = excluded.api_key,
      api_secret = excluded.api_secret,
      session_key = excluded.session_key,
      username = excluded.username
  `).run(userId, merged.apiKey || null, merged.apiSecret || null, merged.sessionKey || null, merged.username || null);
}

function clearLastfmConfig(userId) {
  const db = getDb();
  db.prepare('DELETE FROM lastfm_config WHERE user_id = ?').run(userId);
}

// --- Last.fm Scrobble Queue ---

function getScrobbleQueue(userId) {
  const db = getDb();
  return db.prepare('SELECT * FROM lastfm_scrobble_queue WHERE user_id = ? ORDER BY timestamp').all(userId);
}

function addToScrobbleQueue(userId, { artist, track, album, timestamp, duration }) {
  const db = getDb();
  db.prepare(
    'INSERT INTO lastfm_scrobble_queue (user_id, artist, track, album, timestamp, duration) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userId, artist, track, album || null, timestamp, duration || null);
}

function removeFromScrobbleQueue(ids) {
  if (!ids.length) return;
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM lastfm_scrobble_queue WHERE id IN (${placeholders})`).run(...ids);
}

function getAllUsersWithScrobbleQueue() {
  const db = getDb();
  return db.prepare('SELECT DISTINCT user_id FROM lastfm_scrobble_queue').all().map(r => r.user_id);
}

// --- Global Settings ---

function getGlobalSetting(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM global_settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : null;
}

function setGlobalSetting(key, value) {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO global_settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
}

// --- User Settings ---

function getUserSetting(userId, key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?').get(userId, key);
  return row ? JSON.parse(row.value) : null;
}

function setUserSetting(userId, key, value) {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)').run(userId, key, JSON.stringify(value));
}

function getAllUserSettings(userId) {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM user_settings WHERE user_id = ?').all(userId);
  const settings = {};
  for (const r of rows) {
    settings[r.key] = JSON.parse(r.value);
  }
  return settings;
}

// --- Search History ---

const MAX_SEARCH_HISTORY = 20;

function getSearchHistory(userId) {
  const db = getDb();
  return db.prepare(
    'SELECT query, searched_at as searchedAt FROM search_history WHERE user_id = ? ORDER BY searched_at DESC LIMIT ?'
  ).all(userId, MAX_SEARCH_HISTORY);
}

function addSearchHistory(userId, query) {
  const db = getDb();
  // Remove duplicate
  db.prepare('DELETE FROM search_history WHERE user_id = ? AND LOWER(query) = LOWER(?)').run(userId, query);
  db.prepare('INSERT INTO search_history (user_id, query, searched_at) VALUES (?, ?, ?)').run(userId, query, Date.now());
  // Trim
  db.prepare(
    'DELETE FROM search_history WHERE user_id = ? AND id NOT IN (SELECT id FROM search_history WHERE user_id = ? ORDER BY searched_at DESC LIMIT ?)'
  ).run(userId, userId, MAX_SEARCH_HISTORY);
}

function removeSearchHistory(userId, query) {
  const db = getDb();
  db.prepare('DELETE FROM search_history WHERE user_id = ? AND query = ?').run(userId, query);
}

function clearSearchHistory(userId) {
  const db = getDb();
  db.prepare('DELETE FROM search_history WHERE user_id = ?').run(userId);
}

// --- Favorites ---

function getFavorites(userId) {
  const db = getDb();
  return db.prepare(
    'SELECT track_id as trackId, artist, album, title, added_at as addedAt FROM favorites WHERE user_id = ? ORDER BY added_at DESC'
  ).all(userId);
}

function addFavorite(userId, { trackId, artist, album, title }) {
  const db = getDb();
  db.prepare(
    'INSERT OR IGNORE INTO favorites (user_id, track_id, artist, album, title, added_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userId, trackId, artist, album, title, Date.now());
}

function removeFavorite(userId, trackId) {
  const db = getDb();
  db.prepare('DELETE FROM favorites WHERE user_id = ? AND track_id = ?').run(userId, trackId);
}

function isFavorite(userId, trackId) {
  const db = getDb();
  return !!db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND track_id = ?').get(userId, trackId);
}

// --- User Session ---

function getUserSession(userId) {
  const db = getDb();
  const row = db.prepare('SELECT queue, state FROM user_session WHERE user_id = ?').get(userId);
  if (!row) return { queue: [], state: {} };
  return {
    queue: JSON.parse(row.queue),
    state: JSON.parse(row.state),
  };
}

function saveUserSession(userId, { queue, state }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO user_session (user_id, queue, state)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      queue = excluded.queue,
      state = excluded.state
  `).run(userId, JSON.stringify(queue || []), JSON.stringify(state || {}));
}

// --- Users ---

function getUsers() {
  const db = getDb();
  return db.prepare("SELECT id, display_name as displayName, role FROM users WHERE id != 'default' ORDER BY display_name").all();
}

function isAdmin(userId) {
  const db = getDb();
  const row = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
  return row?.role === 'admin';
}

function isValidUser(userId) {
  const db = getDb();
  return !!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId);
}

// --- Job Log ---

function addJobLog(entry) {
  const db = getDb();
  db.prepare(`INSERT INTO job_log (job_id, artist, album, attempt, duration_ms, outcome, fail_reason, quality)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    entry.job_id, entry.artist, entry.album, entry.attempt,
    entry.duration_ms, entry.outcome, entry.fail_reason || null, entry.quality || null
  );
}

function getJobLogs(limit = 100) {
  const db = getDb();
  return db.prepare(`SELECT * FROM job_log ORDER BY created_at DESC LIMIT ?`).all(limit);
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
  tx();
}

function getScrobbleCount(userId) {
  return getDb().prepare('SELECT COUNT(*) as count FROM scrobbles WHERE user_id = ?').get(userId).count;
}

function getLatestScrobbleTime(userId) {
  const row = getDb().prepare('SELECT MAX(played_at) as latest FROM scrobbles WHERE user_id = ?').get(userId);
  return row?.latest || 0;
}

function rebuildArtistAffinity(userId) {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM artist_affinity WHERE user_id = ?').run(userId);
    db.prepare(`
      INSERT INTO artist_affinity (user_id, artist, play_count, last_played_at)
      SELECT user_id, artist, COUNT(*) as play_count, MAX(played_at) as last_played_at
      FROM scrobbles WHERE user_id = ? GROUP BY user_id, artist
    `).run(userId);
  })();
}

function getArtistAffinity(userId) {
  return getDb().prepare('SELECT * FROM artist_affinity WHERE user_id = ? ORDER BY play_count DESC').all(userId);
}

function getUniqueAlbumsSince(userId, days) {
  const since = Math.floor(Date.now() / 1000) - (days * 86400);
  return getDb().prepare(`
    SELECT DISTINCT artist, album FROM scrobbles
    WHERE user_id = ? AND played_at >= ? AND album != ''
    ORDER BY artist, album
  `).all(userId, since);
}

function searchArtistAffinity(userId, query) {
  const pattern = '%' + query + '%';
  return getDb().prepare(`
    SELECT * FROM artist_affinity
    WHERE user_id = ? AND artist LIKE ? AND play_count >= 2
    ORDER BY play_count DESC LIMIT 3
  `).all(userId, pattern);
}

// Returns the top artists across all users by total play_count.
// Used for pre-warming the MB cache on startup.
function getTopArtists(limit = 30) {
  return getDb().prepare(`
    SELECT artist as name, SUM(play_count) as play_count
    FROM artist_affinity
    GROUP BY artist
    ORDER BY play_count DESC
    LIMIT ?
  `).all(limit);
}

// --- Tracks ---

function upsertTrack({ id, artist, album, title, trackNumber, format, filepath, fileSize }) {
  // Delete any existing track with the same filepath but different id
  // (happens when track ID generation changes across versions)
  getDb().prepare('DELETE FROM tracks WHERE filepath = ? AND id != ?').run(filepath, id);
  return getDb().prepare(`
    INSERT INTO tracks (id, artist, album, title, track_number, format, filepath, file_size, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(id) DO UPDATE SET
      format = excluded.format,
      filepath = excluded.filepath,
      file_size = excluded.file_size,
      track_number = excluded.track_number,
      updated_at = unixepoch()
  `).run(id, artist, album, title, trackNumber || null, format, filepath, fileSize || null);
}

function getTrackById(id) {
  return getDb().prepare('SELECT * FROM tracks WHERE id = ?').get(id);
}

function getAllTracks() {
  return getDb().prepare('SELECT * FROM tracks ORDER BY artist, album, track_number, title').all();
}

function getTracksByAlbum(artist, album) {
  return getDb().prepare('SELECT * FROM tracks WHERE artist = ? AND album = ? ORDER BY track_number, title').all(artist, album);
}

function removeTrackByFilepath(filepath) {
  return getDb().prepare('DELETE FROM tracks WHERE filepath = ?').run(filepath);
}

function removeTrackById(id) {
  return getDb().prepare('DELETE FROM tracks WHERE id = ?').run(id);
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

  db.transaction(() => {
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
  })();
}

/**
 * Remove all tracks whose filepath is not in the provided set.
 * Used by full library scan to prune deleted files.
 */
function pruneDeletedTracks(validFilepaths) {
  if (validFilepaths.size === 0) {
    getDb().prepare('DELETE FROM tracks').run();
    return;
  }
  // SQLite has a variable limit, batch deletes
  const all = getDb().prepare('SELECT id, filepath FROM tracks').all();
  const toDelete = all.filter(t => !validFilepaths.has(t.filepath));
  if (toDelete.length === 0) return;
  const del = getDb().prepare('DELETE FROM tracks WHERE id = ?');
  getDb().transaction(() => {
    for (const t of toDelete) del.run(t.id);
  })();
}

// --- MB Cache ---

function mbCacheGet(key) {
  let db;
  try { db = getDb(); } catch { return null; }
  const row = db.prepare('SELECT data, expires_at FROM mb_cache WHERE key = ?').get(key);
  if (!row) return null;
  if (Date.now() > row.expires_at) {
    db.prepare('DELETE FROM mb_cache WHERE key = ?').run(key);
    return null;
  }
  db.prepare('UPDATE mb_cache SET hit_count = hit_count + 1 WHERE key = ?').run(key);
  return JSON.parse(row.data);
}

function mbCacheSet(key, data, ttlMs) {
  const db = getDb();
  const now = Date.now();
  db.prepare(`INSERT OR REPLACE INTO mb_cache (key, data, expires_at, created_at, hit_count)
              VALUES (?, ?, ?, ?, 0)`).run(key, JSON.stringify(data), now + ttlMs, now);
}

function mbCacheCleanup() {
  const db = getDb();
  const result = db.prepare('DELETE FROM mb_cache WHERE expires_at < ?').run(Date.now());
  return result.changes;
}

function mbCacheStats() {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as total, SUM(hit_count) as hits FROM mb_cache').get();
  return row;
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
};
