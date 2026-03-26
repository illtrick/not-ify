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
router.post('/test', async (req, res) => {
  // Pre-check: if RD traffic routes through a VPN proxy, verify the proxy is reachable
  const proxyUrl = process.env.VPN_PROXY || '';
  if (proxyUrl) {
    try {
      const { URL } = require('url');
      const net = require('net');
      const parsed = new URL(proxyUrl);
      await new Promise((resolve, reject) => {
        const sock = net.connect(parseInt(parsed.port) || 8888, parsed.hostname, resolve);
        sock.setTimeout(3000);
        sock.on('timeout', () => { sock.destroy(); reject(new Error('timeout')); });
        sock.on('error', reject);
      });
    } catch {
      return res.json({ status: 'error', error: 'VPN proxy is not running — configure VPN in Settings before testing Real-Debrid' });
    }
  }
  try {
    const user = await rd.getUserInfo();
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
