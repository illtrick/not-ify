'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../services/db');
const setupMiddleware = require('../middleware/setup');

const router = express.Router();

// GET /api/setup/status
router.get('/status', (req, res) => {
  const userCount = db.getUserCount();
  const setupComplete = db.isSetupComplete();
  const musicDir = db.getGlobalSetting('musicDir');

  const completedSteps = [];
  if (userCount > 0) completedSteps.push('account');
  if (musicDir) completedSteps.push('library');
  if (setupComplete && userCount > 0) completedSteps.push('complete');

  res.json({
    needsSetup: !setupComplete,
    userCount,
    completedSteps,
  });
});

// POST /api/setup/account
router.post('/account', (req, res) => {
  const { displayName } = req.body || {};

  if (!displayName || typeof displayName !== 'string' || !displayName.trim()) {
    return res.status(400).json({ error: 'Missing displayName' });
  }

  const existingCount = db.getUserCount();
  if (existingCount > 0) {
    return res.status(409).json({ error: 'Account already exists. Setup can only create one admin.' });
  }

  // Generate userId from displayName: lowercase, replace non-alphanumeric with hyphens, trim hyphens
  const userId = displayName.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  // Wrap insert in try-catch to handle race condition: two simultaneous requests
  // can both pass the getUserCount() check above. The PRIMARY KEY constraint on
  // the users table will reject the second insert — we surface that as 409.
  try {
    db.createUser(userId, displayName.trim(), 'admin');
  } catch (err) {
    // UNIQUE / PRIMARY KEY constraint violation means another request won the race
    const isConstraintError =
      err && (err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
              err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
              (typeof err.message === 'string' && err.message.includes('UNIQUE constraint failed')));
    if (isConstraintError) {
      return res.status(409).json({ error: 'Account already exists. Setup can only create one admin.' });
    }
    throw err;
  }
  setupMiddleware._resetCache();

  return res.status(201).json({ userId, displayName: displayName.trim(), isAdmin: true });
});

// GET /api/setup/library
router.get('/library', (req, res) => {
  const musicDir = db.getGlobalSetting('musicDir') || process.env.MUSIC_DIR || '/app/music';

  let exists = false;
  let writable = false;
  let freeSpace = null;

  try {
    const stat = fs.statSync(musicDir);
    exists = stat.isDirectory();
  } catch {
    exists = false;
  }

  if (exists) {
    const testFile = path.join(musicDir, `.notify-write-test-${process.pid}`);
    try {
      fs.writeFileSync(testFile, '');
      fs.unlinkSync(testFile);
      writable = true;
    } catch {
      writable = false;
    }

    // Try to get free space via df — skip on platforms where it's unavailable
    try {
      const { execFileSync } = require('child_process');
      if (process.platform === 'win32') {
        // Skip free space on Windows in this context
        freeSpace = null;
      } else {
        const output = execFileSync('df', ['-k', musicDir], { timeout: 2000 }).toString();
        const lines = output.trim().split('\n').filter(l => l.length > 0);
        const lastLine = lines[lines.length - 1];
        const parts = lastLine.trim().split(/\s+/);
        if (parts.length >= 4) {
          freeSpace = parseInt(parts[3], 10) * 1024; // convert KB to bytes
        }
      }
    } catch {
      freeSpace = null;
    }
  }

  res.json({ musicDir, exists, writable, freeSpace });
});

// PUT /api/setup/library
router.put('/library', (req, res) => {
  const { musicDir } = req.body || {};

  if (!musicDir || typeof musicDir !== 'string') {
    return res.status(400).json({ error: 'Missing musicDir' });
  }

  const resolved = path.resolve(musicDir);

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return res.status(400).json({ error: `Path does not exist: ${resolved}` });
  }

  if (!stat.isDirectory()) {
    return res.status(400).json({ error: `Path is not a directory: ${resolved}` });
  }

  db.setGlobalSetting('musicDir', resolved);
  res.json({ saved: true, musicDir: resolved });
});

// GET /api/setup/services
router.get('/services', async (req, res) => {
  const services = [];

  // Last.fm: check lastfm_config table for any row with session_key
  let lastfmConfigured = false;
  try {
    const dbConn = db.getDb();
    const row = dbConn.prepare('SELECT session_key FROM lastfm_config WHERE session_key IS NOT NULL LIMIT 1').get();
    lastfmConfigured = !!row;
  } catch {
    lastfmConfigured = false;
  }
  services.push({ name: 'lastfm', label: 'Last.fm', configured: lastfmConfigured, connected: lastfmConfigured });

  // Real-Debrid
  const rdToken = db.getGlobalSetting('realDebridToken');
  const rdConfigured = !!(rdToken && typeof rdToken === 'string' && rdToken.trim());
  services.push({ name: 'realdebrid', label: 'Real-Debrid', configured: rdConfigured, connected: rdConfigured });

  // VPN — check DB config or env vars (bootstrap may have configured via env)
  const vpnConfig = db.getGlobalSetting('vpnConfig');
  const vpnFromEnv = !!(process.env.VPN_SERVICE_PROVIDER && process.env.OPENVPN_USER);
  const vpnConfigured = !!(vpnConfig && vpnConfig.username) || vpnFromEnv;
  services.push({ name: 'vpn', label: 'VPN', configured: vpnConfigured, connected: vpnConfigured });

  // Soulseek — check DB config AND live slskd connection
  const soulseekConfig = db.getGlobalSetting('soulseekConfig');
  const soulseekDbConfigured = !!(soulseekConfig && soulseekConfig.username);
  // Always check live slskd connection status (not just when DB config is absent)
  let soulseekConnected = false;
  try {
    const slskdUrl = process.env.SLSKD_URL || 'http://slskd:5030';
    const slskdKey = process.env.SLSKD_API_KEY || '';
    const r = await fetch(`${slskdUrl}/api/v0/application`, {
      headers: { 'X-API-Key': slskdKey },
      signal: AbortSignal.timeout(3000),
    });
    if (r.ok) {
      const data = await r.json();
      soulseekConnected = data.server?.isConnected || false;
    }
  } catch { /* slskd unavailable */ }
  const soulseekConfigured = soulseekDbConfigured || soulseekConnected;
  services.push({ name: 'soulseek', label: 'Soulseek', configured: soulseekConfigured, connected: soulseekConnected || soulseekDbConfigured });

  res.json(services);
});

// POST /api/setup/complete
router.post('/complete', (req, res) => {
  const userCount = db.getUserCount();
  if (userCount === 0) {
    return res.status(400).json({ error: 'Cannot complete setup without at least one user account.' });
  }

  db.setGlobalSetting('setup_complete', true);
  setupMiddleware._markComplete();

  res.json({ complete: true });
});

module.exports = router;
