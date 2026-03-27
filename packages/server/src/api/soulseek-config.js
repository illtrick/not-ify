const express = require('express');
const router = express.Router();
const db = require('../services/db');

// slskd connection details (infrastructure, not user-facing)
function getSlskdUrl() {
  const config = db.getGlobalSetting('soulseekConfig');
  return config?.slskdUrl || process.env.SLSKD_URL || 'http://slskd:5030';
}
function getSlskdApiKey() {
  const config = db.getGlobalSetting('soulseekConfig');
  return config?.slskdApiKey || process.env.SLSKD_API_KEY || '';
}

// GET /api/soulseek/status — return Soulseek login state
router.get('/status', async (req, res) => {
  const config = db.getGlobalSetting('soulseekConfig');
  const username = config?.username || null;

  // Try to get live status from slskd
  let connected = false;
  let state = null;
  try {
    const response = await fetch(`${getSlskdUrl()}/api/v0/application`, {
      headers: { 'X-API-Key': getSlskdApiKey() },
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      const data = await response.json();
      connected = data.server?.isConnected || false;
      state = data.server?.state || null;
    }
  } catch { /* slskd unavailable */ }

  // If slskd is configured but not reachable, show "starting" state
  if (!connected && !state && process.env.SLSKD_API_KEY) {
    return res.json({
      configured: !!username || true,
      username,
      connected: false,
      state: 'starting',
      message: 'Soulseek is configured but still initializing',
    });
  }

  res.json({
    configured: !!username,
    username,
    connected,
    state,
  });
});

// POST /api/soulseek/config — save Soulseek username + password
router.post('/config', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing username or password' });

  // Save to our DB
  const existing = db.getGlobalSetting('soulseekConfig') || {};
  db.setGlobalSetting('soulseekConfig', { ...existing, username, password });

  // Persist to .env so creds survive container restarts
  const containerManager = require('../services/container-manager');
  const envUpdated = containerManager.updateEnvFile({
    SLSKD_SLSK_USERNAME: username,
    SLSKD_SLSK_PASSWORD: password,
  });

  // Push credentials to slskd via PATCH /api/v0/options
  let slskdSync = false;
  try {
    const response = await fetch(`${getSlskdUrl()}/api/v0/options`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': getSlskdApiKey(),
      },
      body: JSON.stringify({ soulseek: { username, password } }),
      signal: AbortSignal.timeout(8000),
    });
    slskdSync = response.ok;
  } catch {
    // API push failed — restart slskd so it picks up from env vars
    if (envUpdated) {
      console.log('[soulseek-config] API push failed, restarting slskd container...');
      await containerManager.restartContainer('slskd').catch(() => {});
    }
  }

  res.json({ saved: true, slskdSync, persistent: envUpdated });
});

// POST /api/soulseek/test — verify connection to Soulseek network
router.post('/test', async (req, res) => {
  try {
    const response = await fetch(`${getSlskdUrl()}/api/v0/application`, {
      headers: { 'X-API-Key': getSlskdApiKey() },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      return res.json({ status: 'error', error: `slskd returned HTTP ${response.status}` });
    }
    const data = await response.json();
    res.json({
      status: data.server?.isConnected ? 'ok' : 'error',
      isConnected: data.server?.isConnected ?? false,
      state: data.server?.state ?? null,
      username: data.user?.username ?? null,
      version: data.version?.current ?? null,
    });
  } catch (err) {
    const msg = err.message || '';
    let userMessage = msg;
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
      userMessage = 'Soulseek service is still starting — try again in 30 seconds';
    } else if (msg.includes('timeout') || msg.includes('AbortError')) {
      userMessage = 'Soulseek service is not responding — it may still be initializing';
    }
    res.json({ status: 'error', error: userMessage });
  }
});

module.exports = router;
