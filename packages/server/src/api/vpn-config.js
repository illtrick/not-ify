const express = require('express');
const router = express.Router();
const db = require('../services/db');
const { getProxyFetch, getFailureSummary } = require('../services/proxy');
const vpnProviders = require('../services/vpn-providers');
const containerManager = require('../services/container-manager');

// GET /api/vpn/providers — list of supported VPN providers with regions
router.get('/providers', (req, res) => {
  const providers = vpnProviders.getProviders();
  res.json(providers);
});

// GET /api/vpn/providers/:id/regions — regions for a specific provider
router.get('/providers/:id/regions', (req, res) => {
  const regions = vpnProviders.getProviderRegions(req.params.id);
  if (regions.length === 0) return res.status(404).json({ error: 'Provider not found' });
  res.json(regions);
});

router.get('/regions', (req, res) => {
  // Legacy endpoint — returns regions for configured provider
  const config = db.getGlobalSetting('vpnConfig');
  const providerId = config?.provider || 'private internet access';
  const regions = vpnProviders.getProviderRegions(providerId);
  res.json(regions);
});

router.get('/status', (req, res) => {
  const config = db.getGlobalSetting('vpnConfig');
  if (!config) return res.json({ configured: false });
  const { username, region, provider } = config;
  res.json({ configured: true, username, region, provider: provider || 'private internet access' });
});

router.post('/config', async (req, res) => {
  const { username, password, region, provider } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing username or password' });

  const vpnProvider = provider || 'private internet access';
  const vpnRegion = region || 'US East';

  // Save to DB
  db.setGlobalSetting('vpnConfig', { username, password, region: vpnRegion, provider: vpnProvider });

  // Persist to .env so gluetun picks up creds on restart
  const envUpdated = containerManager.updateEnvFile({
    VPN_PROVIDER: vpnProvider,
    VPN_USERNAME: username,
    VPN_PASSWORD: password,
    VPN_REGION: vpnRegion,
  });

  // Restart gluetun to pick up new creds
  let restarted = false;
  if (containerManager.dockerAvailable()) {
    restarted = await containerManager.restartContainer('gluetun').catch(() => false);
  }

  res.json({ saved: true, persistent: envUpdated, restarted });
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
