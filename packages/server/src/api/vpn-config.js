const express = require('express');
const router = express.Router();
const db = require('../services/db');
const { getProxyFetch, getFailureSummary } = require('../services/proxy');

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

async function checkService(name, url, proxyFetch, timeoutMs = 10000) {
  const start = Date.now();
  try {
    const res = await proxyFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const latency = Date.now() - start;
    if (!res.ok) return { name, status: 'error', error: `HTTP ${res.status}`, latency };
    // For IP service, parse and return the body
    if (name === 'ip') {
      const data = await res.json();
      return { name, status: 'ok', latency, ip: data.ip };
    }
    return { name, status: 'ok', latency };
  } catch (err) {
    return { name, status: 'error', error: err.message, latency: Date.now() - start };
  }
}

router.post('/test', async (req, res) => {
  const proxyUrl = process.env.VPN_PROXY;
  if (!proxyUrl) {
    return res.json({ status: 'proxy_unavailable', message: 'VPN proxy not available (no gluetun sidecar)' });
  }

  const proxyFetch = getProxyFetch();

  const [ipResult, apibay, realdebrid, youtube] = await Promise.all([
    checkService('ip', 'https://api.ipify.org?format=json', proxyFetch),
    checkService('apibay', 'https://apibay.org/q.php?q=test&cat=100', proxyFetch),
    checkService('realdebrid', 'https://api.real-debrid.com/rest/1.0/time', proxyFetch),
    checkService('youtube', 'https://www.youtube.com/robots.txt', proxyFetch),
  ]);

  const vpnIp = ipResult.ip || null;
  const config = db.getGlobalSetting('vpnConfig');
  const region = config?.region || 'unknown';
  const services = { apibay, realdebrid, youtube };
  const allOk = ipResult.status === 'ok' && Object.values(services).every(s => s.status === 'ok');

  res.json({
    status: allOk ? 'ok' : 'degraded',
    ip: vpnIp,
    region,
    services,
    message: allOk
      ? `All services reachable via ${vpnIp} (${region})`
      : `Some services unreachable via VPN (${region})`,
  });
});

router.get('/failures', (req, res) => {
  res.json(getFailureSummary());
});

module.exports = router;
