const fs = require('fs');
const path = require('path');
const db = require('./db');

const CONFIG_DIR = process.env.CONFIG_DIR || '/app/config';

function migrate() {
  console.log('[migrate] Checking for data to migrate...');

  // Initialize DB (creates tables + seeds users)
  db.getDb();

  let migrated = 0;

  // 1. Migrate settings.json → lastfm_config + global_settings
  const settingsPath = path.join(CONFIG_DIR, 'settings.json');
  const settingsMigrated = settingsPath + '.migrated';
  if (fs.existsSync(settingsPath) && !fs.existsSync(settingsMigrated)) {
    try {
      const config = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

      // Last.fm config → default user
      if (config.lastfm) {
        db.saveLastfmConfig('default', {
          apiKey: config.lastfm.apiKey,
          apiSecret: config.lastfm.apiSecret,
          sessionKey: config.lastfm.sessionKey,
          username: config.lastfm.username,
        });
        // Copy to nathan (existing primary user)
        db.saveLastfmConfig('nathan', {
          apiKey: config.lastfm.apiKey,
          apiSecret: config.lastfm.apiSecret,
          sessionKey: config.lastfm.sessionKey,
          username: config.lastfm.username,
        });
        console.log('[migrate] Last.fm config migrated to default + nathan users');
      }

      // Real Debrid token → global settings
      if (config.realDebrid?.apiToken) {
        db.setGlobalSetting('realDebridToken', config.realDebrid.apiToken);
        console.log('[migrate] Real Debrid token migrated to global settings');
      }

      fs.renameSync(settingsPath, settingsMigrated);
      migrated++;
    } catch (err) {
      console.error('[migrate] settings.json migration failed:', err.message);
    }
  }

  // 2. Migrate recently-played.json → recently_played table
  const rpPath = path.join(CONFIG_DIR, 'recently-played.json');
  const rpMigrated = rpPath + '.migrated';
  if (fs.existsSync(rpPath) && !fs.existsSync(rpMigrated)) {
    try {
      const list = JSON.parse(fs.readFileSync(rpPath, 'utf8'));
      if (Array.isArray(list) && list.length > 0) {
        db.bulkSetRecentlyPlayed('default', list);
        // Also set for nathan
        db.bulkSetRecentlyPlayed('nathan', list);
        console.log(`[migrate] ${list.length} recently played items migrated to default + nathan users`);
      }
      fs.renameSync(rpPath, rpMigrated);
      migrated++;
    } catch (err) {
      console.error('[migrate] recently-played.json migration failed:', err.message);
    }
  }

  // 3. Migrate lastfm-queue.json → lastfm_scrobble_queue table
  const queuePath = path.join(CONFIG_DIR, 'lastfm-queue.json');
  const queueMigrated = queuePath + '.migrated';
  if (fs.existsSync(queuePath) && !fs.existsSync(queueMigrated)) {
    try {
      const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
      if (Array.isArray(queue) && queue.length > 0) {
        for (const item of queue) {
          db.addToScrobbleQueue('default', item);
        }
        console.log(`[migrate] ${queue.length} scrobble queue items migrated to default user`);
      }
      fs.renameSync(queuePath, queueMigrated);
      migrated++;
    } catch (err) {
      console.error('[migrate] lastfm-queue.json migration failed:', err.message);
    }
  }

  if (migrated > 0) {
    console.log(`[migrate] Migration complete (${migrated} files migrated)`);
  } else {
    console.log('[migrate] No migration needed');
  }
}

module.exports = { migrate };
