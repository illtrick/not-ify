const express = require('express');
const router = express.Router();
const db = require('../services/db');

// GET /api/soulseek/status
router.get('/status', (req, res) => {
  const config = db.getGlobalSetting('soulseekConfig');
  const url = config?.url || null;
  const apiKey = config?.apiKey || null;
  res.json({
    configured: !!(url && apiKey),
    urlPreview: url ? url : null,
    connected: false, // static; test endpoint does live check
  });
});

// POST /api/soulseek/config — save url + apiKey
router.post('/config', (req, res) => {
  const { url, apiKey } = req.body;
  if (!url || !apiKey) return res.status(400).json({ error: 'Missing url or apiKey' });
  db.setGlobalSetting('soulseekConfig', { url, apiKey });
  res.json({ saved: true });
});

// POST /api/soulseek/test — verify url + apiKey work by hitting slskd server endpoint
router.post('/test', async (req, res) => {
  const config = db.getGlobalSetting('soulseekConfig');
  if (!config?.url || !config?.apiKey) {
    return res.json({ status: 'error', error: 'Not configured' });
  }

  const { url, apiKey } = config;
  try {
    const response = await fetch(`${url}/api/v0/server`, {
      headers: { 'X-API-Key': apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      return res.json({ status: 'error', error: `slskd returned HTTP ${response.status}` });
    }
    const data = await response.json();
    res.json({
      status: 'ok',
      isConnected: data.isConnected ?? null,
      state: data.state ?? null,
      version: data.version ?? null,
    });
  } catch (err) {
    res.json({ status: 'error', error: err.message });
  }
});

module.exports = router;
