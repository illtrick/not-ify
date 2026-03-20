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

  // Only test services that actually route through VPN (ApiBay).
  // RD and YouTube go direct — RD is IP-locked, YouTube blocks VPN IPs.
  const [ipResult, apibay] = await Promise.all([
    checkService('ip', 'https://api.ipify.org?format=json', proxyFetch),
    checkService('apibay', 'https://apibay.org/q.php?q=test&cat=100', proxyFetch),
  ]);

  const vpnIp = ipResult.ip || null;
  const config = db.getGlobalSetting('vpnConfig');
  const region = config?.region || 'unknown';
  const services = { apibay };
  const allOk = ipResult.status === 'ok' && apibay.status === 'ok';

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

router.post('/region', async (req, res) => {
  const { region } = req.body;
  if (!region) return res.status(400).json({ error: 'Missing region' });

  const controlUrl = process.env.GLUETUN_CONTROL_URL || 'http://localhost:8000';
  const apiKey = process.env.GLUETUN_API_KEY || '';
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-API-Key'] = apiKey;
    const response = await fetch(`${controlUrl}/v1/vpn/settings`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ provider: { server_selection: { regions: [region] } } }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const body = await response.text();
      return res.json({ status: 'error', error: `Gluetun returned ${response.status}: ${body}` });
    }

    // Update saved config
    const config = db.getGlobalSetting('vpnConfig') || {};
    config.region = region;
    db.setGlobalSetting('vpnConfig', config);

    res.json({ status: 'ok', region, message: `VPN region changed to ${region}. Reconnecting...` });
  } catch (err) {
    res.json({ status: 'error', error: err.message });
  }
});

module.exports = router;
