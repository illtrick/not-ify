const express = require('express');
const router = express.Router();
const db = require('../services/db');

// Common PIA regions (source: PIA server list, March 2026)
const PIA_REGIONS = [
  'US East', 'US West', 'US California', 'US Chicago', 'US Denver',
  'US Florida', 'US Houston', 'US Las Vegas', 'US New York', 'US Seattle',
  'US Silicon Valley', 'US Washington DC', 'US Atlanta',
  'CA Montreal', 'CA Ontario', 'CA Toronto', 'CA Vancouver',
  'UK London', 'UK Manchester', 'UK Southampton',
  'DE Berlin', 'DE Frankfurt',
  'Netherlands', 'Switzerland', 'Sweden', 'Norway', 'Denmark', 'Finland',
  'France', 'Belgium', 'Austria', 'Czech Republic', 'Poland', 'Romania',
  'Spain', 'Italy', 'Ireland', 'Iceland',
  'AU Melbourne', 'AU Sydney', 'AU Perth',
  'Japan', 'Singapore', 'Hong Kong', 'Israel', 'India',
  'Brazil', 'Argentina', 'Mexico',
];

router.get('/regions', (req, res) => {
  res.json(PIA_REGIONS);
});

router.get('/status', (req, res) => {
  const config = db.getGlobalSetting('vpnConfig');
  if (!config) return res.json({ configured: false });
  // Explicit destructuring — never leak password
  const { username, region } = config;
  res.json({ configured: true, username, region });
});

router.post('/config', (req, res) => {
  const { username, password, region } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing username or password' });
  db.setGlobalSetting('vpnConfig', { username, password, region: region || 'US East' });
  res.json({ saved: true });
});

router.post('/test', async (req, res) => {
  const proxyUrl = process.env.VPN_PROXY;
  if (!proxyUrl) {
    return res.json({ status: 'proxy_unavailable', message: 'VPN proxy not available (dev mode — no gluetun sidecar)' });
  }
  try {
    const { ProxyAgent } = require('undici');
    const agent = new ProxyAgent(proxyUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch('https://api.ipify.org?format=json', {
      dispatcher: agent,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await response.json();
    const config = db.getGlobalSetting('vpnConfig');
    const region = config?.region || 'unknown';
    res.json({ status: 'ok', ip: data.ip, region, message: `Connected via ${data.ip} (${region})` });
  } catch (err) {
    res.json({ status: 'error', error: err.message });
  }
});

module.exports = router;
