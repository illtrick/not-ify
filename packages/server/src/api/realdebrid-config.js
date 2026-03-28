const express = require('express');
const router = express.Router();
const db = require('../services/db');
const rd = require('../services/realdebrid');

// GET /api/realdebrid/status
router.get('/status', (req, res) => {
  const token = db.getGlobalSetting('realDebridToken');
  res.json({
    configured: !!token,
    tokenPreview: token ? `${token.slice(0, 6)}...${token.slice(-3)}` : null,
  });
});

// POST /api/realdebrid/config — save token
router.post('/config', (req, res) => {
  const { apiToken } = req.body;
  if (!apiToken) return res.status(400).json({ error: 'Missing apiToken' });
  db.setGlobalSetting('realDebridToken', apiToken);
  rd.setToken(apiToken);
  res.json({ saved: true });
});

// POST /api/realdebrid/test — verify token works
// Uses direct fetch (not VPN proxy) since RD API doesn't need VPN
router.post('/test', async (req, res) => {
  try {
    const token = db.getGlobalSetting('realDebridToken');
    if (!token) return res.json({ status: 'error', error: 'No API token configured' });
    const r = await fetch('https://api.real-debrid.com/rest/1.0/user', {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      const body = await r.text();
      return res.json({ status: 'error', error: `API returned ${r.status}: ${body}` });
    }
    const user = await r.json();
    res.json({
      status: 'ok',
      user: {
        username: user.username, email: user.email,
        type: user.type, premium: user.premium, expiration: user.expiration,
      },
    });
  } catch (err) {
    res.json({ status: 'error', error: err.message });
  }
});

module.exports = router;
