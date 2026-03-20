const lastfm = require('./lastfm');
const db = require('./db');

const DELTA_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const intervals = new Map();

async function fullSync(userId, lastfmUsername) {
  const startedAt = Date.now();

  setSyncState(userId, { state: 'syncing', total: 0, fetched: 0, startedAt });

  let page = 1;
  let totalPages = 1;
  let fetched = 0;

  while (page <= totalPages) {
    let result;
    try {
      result = await lastfm.getRecentTracksPage(lastfmUsername, page, 200);
    } catch (err) {
      if (err.message && err.message.includes('429')) {
        console.warn(`[scrobble-sync] Rate limited, backing off 30s (page ${page})`);
        await sleep(30000);
        continue;
      }
      throw err;
    }
    totalPages = result.totalPages;

    const scrobbles = result.tracks
      .filter(t => t.date)
      .map(t => ({
        artist: t.artist?.['#text'] || t.artist?.name || '',
        album: t.album?.['#text'] || '',
        track: t.name || '',
        played_at: parseInt(t.date?.uts || '0', 10),
      }));

    db.insertScrobbles(userId, scrobbles);
    fetched += scrobbles.length;
    setSyncState(userId, { state: 'syncing', total: result.total, fetched, startedAt });
    page++;
  }

  db.rebuildArtistAffinity(userId);
  setSyncState(userId, { state: 'complete', total: fetched, lastSyncedAt: Math.floor(Date.now() / 1000) });
  console.info(`[scrobble-sync] Full sync complete for ${userId}: ${fetched} scrobbles`);
  return { fetched };
}

async function deltaSync(userId, lastfmUsername) {
  const syncState = getSyncState(userId);
  const from = syncState.lastSyncedAt || 0;
  if (!from) return fullSync(userId, lastfmUsername);

  let page = 1, totalPages = 1, fetched = 0;
  while (page <= totalPages) {
    const result = await lastfm.getRecentTracksPage(lastfmUsername, page, 200, from);
    totalPages = result.totalPages;
    const scrobbles = result.tracks
      .filter(t => t.date)
      .map(t => ({
        artist: t.artist?.['#text'] || t.artist?.name || '',
        album: t.album?.['#text'] || '',
        track: t.name || '',
        played_at: parseInt(t.date?.uts || '0', 10),
      }));
    db.insertScrobbles(userId, scrobbles);
    fetched += scrobbles.length;
    page++;
  }

  db.rebuildArtistAffinity(userId);
  setSyncState(userId, { state: 'complete', lastSyncedAt: Math.floor(Date.now() / 1000) });
  console.info(`[scrobble-sync] Delta sync for ${userId}: ${fetched} new scrobbles`);
  return { fetched };
}

function setSyncState(userId, state) {
  // db.setUserSetting stringifies internally — pass plain object
  db.setUserSetting(userId, 'scrobbleSync', state);
}

function getSyncState(userId) {
  try {
    // db.getUserSetting parses internally — returns plain object or null
    return db.getUserSetting(userId, 'scrobbleSync') || {};
  } catch {
    return {};
  }
}

function scheduleDeltaSync(userId, lastfmUsername) {
  if (intervals.has(userId)) return;
  const timer = setInterval(() => {
    deltaSync(userId, lastfmUsername).catch(err =>
      console.error(`[scrobble-sync] Delta sync failed for ${userId}:`, err.message)
    );
  }, DELTA_INTERVAL_MS);
  intervals.set(userId, timer);
}

function startDeltaSyncScheduler() {
  try {
    const users = db.getUsers ? db.getUsers() : [];
    for (const user of users) {
      const config = db.getLastfmConfig ? db.getLastfmConfig(user.id) : null;
      if (config && config.sessionKey && config.username) {
        scheduleDeltaSync(user.id, config.username);
      }
    }
  } catch (err) {
    console.warn('[scrobble-sync] Could not start delta sync scheduler:', err.message);
  }
}

function stopAll() {
  for (const timer of intervals.values()) clearInterval(timer);
  intervals.clear();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { fullSync, deltaSync, startDeltaSyncScheduler, scheduleDeltaSync, stopAll };
