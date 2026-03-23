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

  try {
    while (page <= totalPages) {
      let retries = 0;
      let result;
      while (retries < 5) {
        try {
          result = await lastfm.getRecentTracksPage(lastfmUsername, page, 200);
          break; // success
        } catch (err) {
          if ((err.message?.includes('429') || err.message?.includes('500')) && retries < 4) {
            const backoff = err.message.includes('429') ? 30000 : 10000;
            console.warn(`[scrobble-sync] API ${err.message.includes('429') ? '429' : '500'}, backing off ${backoff/1000}s (page ${page}, attempt ${retries + 1})`);
            await sleep(backoff);
            retries++;
            continue;
          }
          throw err; // other error or max retries exceeded
        }
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
  } catch (err) {
    console.error(`[scrobble-sync] Full sync failed for ${userId} at page ${page}:`, err.message);
    setSyncState(userId, { state: 'error', error: err.message, fetched });
    throw err;
  }

  db.rebuildArtistAffinity(userId);
  setSyncState(userId, { state: 'complete', total: fetched, lastSyncedAt: Math.floor(Date.now() / 1000) });
  console.info(`[scrobble-sync] Full sync complete for ${userId}: ${fetched} scrobbles`);
  return { fetched };
}

async function deltaSync(userId, lastfmUsername) {
  // Use the latest scrobble timestamp from the DB, not the sync state.
  // This way, if a previous sync crashed mid-way, we resume from where
  // the DB actually has data — not from zero.
  const latestInDb = db.getLatestScrobbleTime(userId);
  const syncState = getSyncState(userId);
  const from = latestInDb || syncState.lastSyncedAt || 0;
  if (!from) return fullSync(userId, lastfmUsername);

  let page = 1, totalPages = 1, fetched = 0;
  while (page <= totalPages) {
    let retries = 0;
    let result;
    while (retries < 5) {
      try {
        result = await lastfm.getRecentTracksPage(lastfmUsername, page, 200, from);
        break;
      } catch (err) {
        if ((err.message?.includes('429') || err.message?.includes('500')) && retries < 4) {
          const backoff = err.message.includes('429') ? 30000 : 10000;
          await sleep(backoff);
          retries++;
          continue;
        }
        throw err;
      }
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

function getStatus() {
  const db = require('./db');
  const users = db.getUsers();
  const syncs = {};
  for (const u of users) {
    const state = getSyncState(u.id);
    syncs[u.display_name || u.id] = {
      state: state.state || 'idle',
      lastSyncedAt: state.lastSyncedAt || null,
      total: state.total || 0,
      fetched: state.fetched || 0,
      error: state.error || null,
      scheduled: intervals.has(u.id),
    };
  }
  return syncs;
}

/**
 * Reset stale 'syncing' states on startup.
 * If the server crashed mid-sync, the state is stuck forever.
 * Reset to 'error' so the user can retry.
 */
function resetStaleSyncs() {
  try {
    const users = db.getUsers();
    for (const user of users) {
      const state = getSyncState(user.id);
      if (state.state === 'syncing') {
        const ageMs = Date.now() - (state.startedAt || 0);
        // If syncing for more than 30 minutes, it's stale
        if (ageMs > 30 * 60 * 1000) {
          console.warn(`[scrobble-sync] Resetting stale sync for ${user.id} (stuck for ${Math.round(ageMs / 60000)}m)`);
          setSyncState(user.id, {
            state: 'error',
            error: 'Sync interrupted (server restart). Click Sync Now to retry.',
            fetched: state.fetched || 0,
            lastSyncedAt: state.lastSyncedAt,
          });
        }
      }
    }
  } catch {}
}

// Run on module load
resetStaleSyncs();

module.exports = { fullSync, deltaSync, startDeltaSyncScheduler, scheduleDeltaSync, stopAll, getStatus };
