# VPN Infrastructure & Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route sensitive traffic (ApiBay search, RealDebrid API, yt-dlp) through a gluetun VPN proxy on staging/prod, with per-service health observability and live region switching.

**Architecture:** Gluetun runs in bridge mode as a sidecar container, exposing an HTTP CONNECT proxy on port 8888. The Not-ify server routes sensitive fetch calls through `undici.ProxyAgent` (pattern already established in `downloader.js`). Non-sensitive traffic (MusicBrainz, Last.fm, DLNA/SSDP) stays direct. A new VPN health system tracks per-service proxy failures passively, exposes them via API, and surfaces them in the Settings UI alongside live region switching via gluetun's control API.

**Tech Stack:** Node.js, undici ProxyAgent, Express, gluetun (Docker), PIA OpenVPN, React (Settings UI)

---

### Task 1: Add VPN proxy to ApiBay search

**Files:**
- Modify: `packages/server/src/services/search.js`
- Test: manual verification (no test file exists for search)

- [ ] **Step 1: Add undici import and proxy helper to search.js**

At the top of `search.js`, add the proxy-aware fetch helper (same pattern as `downloader.js`):

```javascript
const { ProxyAgent, fetch: undiciFetch } = require('undici');

function getProxyFetch() {
  const proxy = process.env.VPN_PROXY || '';
  if (!proxy) return fetch;
  const dispatcher = new ProxyAgent(proxy);
  return (url, opts) => undiciFetch(url, { ...opts, dispatcher });
}
```

- [ ] **Step 2: Replace bare `fetch` with `getProxyFetch()` in `searchMusic`**

In the `searchMusic` function, replace:
```javascript
const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
```
with:
```javascript
const proxyFetch = getProxyFetch();
const res = await proxyFetch(url, { signal: AbortSignal.timeout(10000) });
```

- [ ] **Step 3: Verify server starts without errors**

Run: `cd packages/server && node -e "require('./src/services/search')"`
Expected: exits cleanly with no errors

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/search.js
git commit -m "feat(vpn): route ApiBay search through VPN proxy"
```

---

### Task 2: Add VPN proxy to RealDebrid API calls

**Files:**
- Modify: `packages/server/src/services/realdebrid.js`

- [ ] **Step 1: Add undici import and proxy helper to realdebrid.js**

At the top of `realdebrid.js` (after existing imports), add:

```javascript
const { ProxyAgent, fetch: undiciFetch } = require('undici');

function getProxyFetch() {
  const proxy = process.env.VPN_PROXY || '';
  if (!proxy) return fetch;
  const dispatcher = new ProxyAgent(proxy);
  return (url, opts) => undiciFetch(url, { ...opts, dispatcher });
}
```

- [ ] **Step 2: Replace bare `fetch` with `getProxyFetch()` in `rdFetch`**

In the `rdFetch` function, replace:
```javascript
const res = await fetch(url, {
```
with:
```javascript
const proxyFetch = getProxyFetch();
const res = await proxyFetch(url, {
```

- [ ] **Step 3: Verify server starts without errors**

Run: `cd packages/server && node -e "require('./src/services/realdebrid')"`
Expected: exits cleanly (may throw "token not configured" — that's fine, not a proxy error)

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/realdebrid.js
git commit -m "feat(vpn): route RealDebrid API calls through VPN proxy"
```

---

### Task 3: Extract shared proxy helper to avoid duplication

**Files:**
- Create: `packages/server/src/services/proxy.js`
- Modify: `packages/server/src/services/search.js`
- Modify: `packages/server/src/services/realdebrid.js`
- Modify: `packages/server/src/services/downloader.js`
- Modify: `packages/server/src/services/youtube.js`

After Tasks 1 and 2, three files have identical `getProxyFetch()` implementations, and `youtube.js` has a local `getProxyArgs()`. Extract both to a shared module.

- [ ] **Step 1: Create `proxy.js` with shared helpers**

```javascript
const { ProxyAgent, fetch: undiciFetch } = require('undici');

/**
 * Returns a fetch function that routes through VPN_PROXY if configured.
 * Uses undici ProxyAgent with HTTP CONNECT — DNS resolves proxy-side.
 */
function getProxyFetch() {
  const proxy = process.env.VPN_PROXY || '';
  if (!proxy) return fetch;
  const dispatcher = new ProxyAgent(proxy);
  return (url, opts) => undiciFetch(url, { ...opts, dispatcher });
}

/**
 * Returns yt-dlp CLI args to route through proxy.
 */
function getProxyArgs() {
  const proxy = process.env.VPN_PROXY || '';
  return proxy ? ['--proxy', proxy] : [];
}

module.exports = { getProxyFetch, getProxyArgs };
```

- [ ] **Step 2: Update search.js to import from proxy.js**

Remove the local `getProxyFetch` function and undici import. Add:
```javascript
const { getProxyFetch } = require('./proxy');
```

- [ ] **Step 3: Update realdebrid.js to import from proxy.js**

Remove the local `getProxyFetch` function and undici import. Add:
```javascript
const { getProxyFetch } = require('./proxy');
```

- [ ] **Step 4: Update downloader.js to import from proxy.js**

Remove the local `getProxyFetch` function and the `const { ProxyAgent, fetch: undiciFetch } = require('undici');` import. Add:
```javascript
const { getProxyFetch } = require('./proxy');
```

- [ ] **Step 5: Update youtube.js to import `getProxyArgs` from proxy.js**

Remove the local `getProxyArgs` function (lines 10-13) and `VPN_PROXY` reference. Add:
```javascript
const { getProxyArgs } = require('./proxy');
```

- [ ] **Step 6: Verify all four modules load correctly**

Run:
```bash
cd packages/server
node -e "require('./src/services/search'); require('./src/services/downloader'); require('./src/services/youtube'); console.log('OK')"
```
Expected: prints "OK"

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/proxy.js packages/server/src/services/search.js packages/server/src/services/realdebrid.js packages/server/src/services/downloader.js packages/server/src/services/youtube.js
git commit -m "refactor: extract shared VPN proxy helper to proxy.js"
```

---

### Task 4: Enhanced VPN test endpoint — per-service health checks

**Files:**
- Modify: `packages/server/src/api/vpn-config.js`

The current `/api/vpn/test` only checks ipify.org. Enhance it to probe each service that routes through the proxy and report per-service status.

- [ ] **Step 1: Add per-service health check function and import**

Add to `vpn-config.js`:

```javascript
const { getProxyFetch } = require('../services/proxy');

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
```

- [ ] **Step 2: Replace `/test` endpoint with per-service checks**

Replace the existing `router.post('/test', ...)` with:

```javascript
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
```

- [ ] **Step 3: Verify the module loads**

Run: `cd packages/server && node -e "require('./src/api/vpn-config')"`
Expected: exits cleanly

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/api/vpn-config.js
git commit -m "feat(vpn): per-service health checks in VPN test endpoint"
```

---

### Task 5: Passive VPN failure tracking

**Files:**
- Modify: `packages/server/src/services/proxy.js`
- Modify: `packages/server/src/api/vpn-config.js`

Track proxy failures per-service passively (no active probing — just count errors as they happen in normal operation). Expose failure counts via API for the UI.

- [ ] **Step 1: Add failure counter to proxy.js**

Add to `proxy.js`:

```javascript
// Per-service failure tracking
const failureCounts = {};
const FAILURE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

function recordFailure(service, error) {
  if (!failureCounts[service]) failureCounts[service] = [];
  failureCounts[service].push({ time: Date.now(), error: error.substring(0, 200) });
  // Prune old entries
  const cutoff = Date.now() - FAILURE_WINDOW_MS;
  failureCounts[service] = failureCounts[service].filter(f => f.time > cutoff);
}

function getFailureSummary() {
  const cutoff = Date.now() - FAILURE_WINDOW_MS;
  const summary = {};
  for (const [service, failures] of Object.entries(failureCounts)) {
    const recent = failures.filter(f => f.time > cutoff);
    if (recent.length > 0) {
      summary[service] = {
        count: recent.length,
        lastError: recent[recent.length - 1].error,
        lastAt: recent[recent.length - 1].time,
      };
    }
  }
  return summary;
}

module.exports = { getProxyFetch, getProxyArgs, recordFailure, getFailureSummary };
```

- [ ] **Step 2: Instrument search.js to record failures**

In `searchMusic`'s catch block, add:
```javascript
const { recordFailure } = require('./proxy');
```
at the top, then inside the catch:
```javascript
recordFailure('apibay', err.message);
```

- [ ] **Step 3: Instrument realdebrid.js to record failures**

In `rdFetch`'s error path (when `!res.ok` or on catch), add:
```javascript
const { recordFailure } = require('./proxy');
```
at the top. In the `if (!res.ok)` block before the throw:
```javascript
recordFailure('realdebrid', `${res.status} on ${endpoint}`);
```

- [ ] **Step 4: Instrument downloader.js to record failures**

At the top, the import from proxy.js already exists (from Task 3). Update it to also import `recordFailure`:
```javascript
const { getProxyFetch, recordFailure } = require('./proxy');
```
In `downloadFile`'s catch path (the `if (!res.ok)` check), add before the throw:
```javascript
recordFailure('download', `${res.status} ${res.statusText}`);
```

- [ ] **Step 5: Add failure summary endpoint**

In `vpn-config.js`, add:
```javascript
const { getFailureSummary } = require('../services/proxy');

router.get('/failures', (req, res) => {
  res.json(getFailureSummary());
});
```

- [ ] **Step 6: Verify module loads**

Run: `cd packages/server && node -e "require('./src/services/proxy'); require('./src/api/vpn-config'); console.log('OK')"`
Expected: prints "OK"

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/proxy.js packages/server/src/services/search.js packages/server/src/services/realdebrid.js packages/server/src/services/downloader.js packages/server/src/api/vpn-config.js
git commit -m "feat(vpn): passive per-service failure tracking"
```

---

### Task 6: Live region switching via gluetun control API

**Files:**
- Modify: `packages/server/src/api/vpn-config.js`

Gluetun exposes a control API on port 8000. Add an endpoint to change VPN region without restarting the container.

- [ ] **Step 1: Add region switch endpoint**

Add to `vpn-config.js`:

```javascript
router.post('/region', async (req, res) => {
  const { region } = req.body;
  if (!region) return res.status(400).json({ error: 'Missing region' });

  const controlUrl = process.env.GLUETUN_CONTROL_URL || 'http://localhost:8000';
  try {
    const response = await fetch(`${controlUrl}/v1/openvpn/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server_regions: [region] }),
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
```

- [ ] **Step 2: Verify module loads**

Run: `cd packages/server && node -e "require('./src/api/vpn-config')"`
Expected: exits cleanly

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/api/vpn-config.js
git commit -m "feat(vpn): live region switching via gluetun control API"
```

---

### Task 7: Settings UI — per-service health indicators and region switching

**Files:**
- Modify: `packages/shared/src/api-client.js` (add `switchVpnRegion` function)
- Modify: `packages/client/src/components/SettingsModal.jsx`

The app uses a shared API client (`packages/shared/src/api-client.js`) with `get()`/`post()` helpers that handle `baseUrl`. All new API calls must go through this client — never use raw `fetch` with a hardcoded base URL in components.

- [ ] **Step 1: Add `switchVpnRegion` and `getVpnFailures` to api-client.js**

Add to the VPN Config section of `packages/shared/src/api-client.js`:

```javascript
export function switchVpnRegion(region) {
  return post('/api/vpn/region', { region });
}

export function getVpnFailures() {
  return get('/api/vpn/failures');
}
```

- [ ] **Step 2: Update the VPN test result display in SettingsModal.jsx**

Replace the test result display block (the `{vpnConfig.testResult && (...)}` section) with a richer display that shows per-service status:

```jsx
{vpnConfig.testResult && (
  <div style={{ marginTop: 8, fontSize: 12 }}>
    {vpnConfig.testResult.status === 'proxy_unavailable' ? (
      <div style={{ color: COLORS.textSecondary }}>
        VPN proxy not available (dev mode)
      </div>
    ) : (
      <>
        <div style={{
          color: vpnConfig.testResult.status === 'ok' ? COLORS.success : COLORS.warning,
          marginBottom: 4,
        }}>
          {vpnConfig.testResult.ip
            ? `Connected via ${vpnConfig.testResult.ip} (${vpnConfig.testResult.region})`
            : 'VPN connection check complete'}
        </div>
        {vpnConfig.testResult.services && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {Object.entries(vpnConfig.testResult.services).map(([name, svc]) => (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
                  backgroundColor: svc.status === 'ok' ? COLORS.success : COLORS.error,
                }} />
                <span style={{ color: COLORS.textPrimary }}>{name}</span>
                <span style={{ color: COLORS.textSecondary }}>
                  {svc.status === 'ok' ? `${svc.latency}ms` : svc.error}
                </span>
              </div>
            ))}
          </div>
        )}
      </>
    )}
  </div>
)}
```

- [ ] **Step 3: Add a "Switch Region" button using the shared API client**

After the "Test Connection" button, add a region switch button that calls `api.switchVpnRegion()`:

```jsx
<button
  onClick={async () => {
    try {
      const data = await api.switchVpnRegion(vpnRegion);
      if (data.status === 'ok') {
        // After region switch, auto-test to verify new connection
        setTimeout(() => vpnConfig.test(), 5000);
      }
    } catch {}
  }}
  style={buttonSecondaryStyle}
>
  Switch Region
</button>
```

Note: `api` is already imported in SettingsModal.jsx (used for other service calls). The `switchVpnRegion` function was added to the shared API client in Step 1.

- [ ] **Step 4: Verify client builds**

Run: `cd packages/client && npx vite build --mode development 2>&1 | tail -5`
Expected: build succeeds

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/api-client.js packages/client/src/components/SettingsModal.jsx
git commit -m "feat(vpn): per-service health indicators and region switching in Settings UI"
```

---

### Task 8: QNAP deployment — add gluetun sidecar to staging

**Files:**
- Modify: `deploy/qnap/docker-compose.yml`
- Modify: `docker/gluetun.env.example`

Add gluetun as a sidecar for staging on QNAP. Key constraint: gluetun MUST run in bridge mode (NOT host mode) — host mode modifies host iptables and breaks DLNA/SSDP multicast. The Not-ify staging container stays on host network for DLNA but reaches gluetun's proxy at `localhost:8888` via port mapping.

- [ ] **Step 1: Add gluetun service to QNAP compose**

Add after the `not-ify-staging` service:

```yaml
  # ---------------------------------------------------------------------------
  # Gluetun VPN sidecar — HTTP proxy for staging (bridge mode, NOT host)
  # Exposes port 8888 (HTTP proxy) and 8000 (control API) to host network
  # ---------------------------------------------------------------------------
  gluetun:
    image: qmcgaw/gluetun
    container_name: gluetun
    cap_add:
      - NET_ADMIN
    devices:
      - /dev/net/tun:/dev/net/tun
    environment:
      - VPN_SERVICE_PROVIDER=private internet access
      - VPN_TYPE=openvpn
      - OPENVPN_USER=${PIA_USERNAME}
      - OPENVPN_PASSWORD=${PIA_PASSWORD}
      - SERVER_REGIONS=${VPN_REGION:-US West}
      - DOT=on
      - DOT_PROVIDERS=${DOT_PROVIDERS:-cloudflare}
      - HTTPPROXY=on
      - HTTPPROXY_LOG=off
    ports:
      - "8888:8888/tcp"
      - "8000:8000/tcp"
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://ip.me"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped
```

- [ ] **Step 2: Add VPN env vars to staging service**

Add to the `not-ify-staging` environment section:
```yaml
      - VPN_ENABLED=${VPN_ENABLED:-false}
      - VPN_PROXY=http://localhost:8888
      - GLUETUN_CONTROL_URL=http://localhost:8000
```

Note: since staging uses `network_mode: host`, `localhost:8888` reaches gluetun's mapped port.

- [ ] **Step 3: Update gluetun.env.example with control API note**

Add to `docker/gluetun.env.example`:
```
# Gluetun control API (for live region switching)
# Exposed on port 8000, accessible to Not-ify at GLUETUN_CONTROL_URL
GLUETUN_CONTROL_URL=http://localhost:8000
```

- [ ] **Step 4: Commit**

```bash
git add deploy/qnap/docker-compose.yml docker/gluetun.env.example
git commit -m "feat(vpn): add gluetun VPN sidecar to QNAP staging deployment"
```

---

### Task 9: Pre-deployment verification on staging

This task is manual and cannot be TDD'd. It validates the full VPN stack on staging.

- [ ] **Step 1: Verify /dev/net/tun exists on QNAP**

SSH into QNAP and run:
```bash
ls -la /dev/net/tun
```
If missing: install QVPN from App Center, or run `mkdir -p /dev/net && mknod /dev/net/tun c 10 200`.

- [ ] **Step 2: Set PIA credentials in QNAP .env**

In the QNAP deploy directory, create/update `.env`:
```
PIA_USERNAME=<your-pia-username>
PIA_PASSWORD=<your-pia-password>
VPN_REGION=US West
VPN_ENABLED=true
```

- [ ] **Step 3: Deploy updated compose**

```bash
cd /share/CACHEDEV1_DATA/not-ify
docker compose up -d
```

- [ ] **Step 4: Verify gluetun is healthy**

```bash
docker logs gluetun --tail 20
# Should show: "healthy!" and an assigned VPN IP
curl -s http://localhost:8888 | head -5
# Should show proxy response (or connection refused if no target — that's fine)
```

- [ ] **Step 5: Test VPN via Settings UI**

Open `http://192.168.0.34:3001` → Settings → VPN section → click "Test Connection".
Expected: all three services show green dots with latency.

- [ ] **Step 6: Test region switch**

Select a different region (e.g., "US California") → click "Switch Region" → wait 5s for auto-test.
Expected: IP changes, all services still reachable.

- [ ] **Step 7: E2E test — search, stream, download**

1. Search for a known album → verify results appear (ApiBay through proxy)
2. Stream a track → verify playback works
3. Download a track → verify file appears in library (RD API + download through proxy)

---

### Task 10: Improve Last.fm sync status display

**Files:**
- Modify: `packages/client/src/components/SettingsModal.jsx`

The sync status box (lines 152-176) has two problems: the `error` state falls through to "Scrobble sync will start automatically once connected…" (misleading), and the `syncing` state shows raw counts without percentage. Fix both.

- [ ] **Step 1: Add error state with Retry button**

In the sync status section, the current code has three branches: `syncing`, `complete`, and a fallback else. Add an explicit `error` branch before the fallback. Replace:

```jsx
) : (
  <span style={{ color: COLORS.textSecondary }}>
    Scrobble sync will start automatically once connected…
  </span>
)}
```

with:

```jsx
) : syncStatus?.state === 'error' ? (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
    <span style={{ color: COLORS.error }}>
      Sync failed{syncStatus.fetched ? ` at ${syncStatus.fetched.toLocaleString()} scrobbles` : ''}: {syncStatus.error}
    </span>
    <button onClick={onSyncNow} style={{
      padding: '4px 10px', borderRadius: 4, border: `1px solid ${COLORS.border}`,
      background: 'transparent', color: COLORS.textPrimary, fontSize: 11, cursor: 'pointer',
    }}>Retry</button>
  </div>
) : (
  <span style={{ color: COLORS.textSecondary }}>
    Scrobble sync will start automatically once connected…
  </span>
)}
```

- [ ] **Step 2: Add percentage to syncing state**

Replace the syncing branch text:

```jsx
Syncing Last.fm history… {syncStatus.fetched || 0} / {syncStatus.total || '?'} scrobbles
```

with:

```jsx
Syncing Last.fm history… {(syncStatus.fetched || 0).toLocaleString()} / {(syncStatus.total || 0).toLocaleString()} scrobbles ({syncStatus.total ? Math.round((syncStatus.fetched / syncStatus.total) * 100) : 0}%)
```

- [ ] **Step 3: Show total count in completed state**

Replace the completed branch's "Last synced" text:

```jsx
return hrs >= 1 ? `Last synced: ${hrs}h ago` : `Last synced: ${Math.floor(secsAgo / 60)}m ago`;
```

with:

```jsx
const count = syncStatus.total ? `${syncStatus.total.toLocaleString()} scrobbles · ` : '';
return hrs >= 1 ? `${count}Last synced: ${hrs}h ago` : `${count}Last synced: ${Math.floor(secsAgo / 60)}m ago`;
```

- [ ] **Step 4: Verify client builds**

Run: `cd packages/client && npx vite build --mode development 2>&1 | tail -5`
Expected: build succeeds

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/SettingsModal.jsx
git commit -m "fix(ui): show sync error state with retry, add percentage and scrobble count"
```

---

## Summary of Services and Proxy Routing

| Service | Route | Why |
|---------|-------|-----|
| ApiBay search | VPN proxy | Torrent search — ISP visibility concern |
| RealDebrid API | VPN proxy | Debrid service — API calls should be private |
| RealDebrid downloads | VPN proxy | Already implemented in `downloader.js` |
| yt-dlp | VPN proxy | Already implemented in `youtube.js` |
| MusicBrainz | Direct | Public metadata API, no privacy concern |
| Last.fm | Direct | Authenticated user API, no privacy concern |
| DLNA/SSDP | Direct | Local network multicast, must NOT go through VPN |
| Cover art (external) | Direct | Public image URLs, no privacy concern |

## Environment Variables Reference

| Variable | Purpose | Default | Where Set |
|----------|---------|---------|-----------|
| `VPN_PROXY` | HTTP proxy URL for routing traffic through gluetun | (empty = no proxy) | Docker compose env |
| `VPN_ENABLED` | Feature flag for VPN functionality | `false` | Docker compose env |
| `GLUETUN_CONTROL_URL` | Gluetun control API for live region switching | `http://localhost:8000` | Docker compose env |
| `PIA_USERNAME` | PIA OpenVPN username | — | `.env` file on QNAP |
| `PIA_PASSWORD` | PIA OpenVPN password | — | `.env` file on QNAP |
| `VPN_REGION` | Default PIA server region | `US West` | `.env` file on QNAP |

## Files Changed (Complete List)

| File | Action | Task |
|------|--------|------|
| `packages/server/src/services/proxy.js` | Create | 3, 5 |
| `packages/server/src/services/search.js` | Modify | 1, 3, 5 |
| `packages/server/src/services/realdebrid.js` | Modify | 2, 3, 5 |
| `packages/server/src/services/downloader.js` | Modify | 3, 5 |
| `packages/server/src/services/youtube.js` | Modify | 3 |
| `packages/server/src/api/vpn-config.js` | Modify | 4, 5, 6 |
| `packages/shared/src/api-client.js` | Modify | 7 |
| `packages/client/src/components/SettingsModal.jsx` | Modify | 7 |
| `deploy/qnap/docker-compose.yml` | Modify | 8 |
| `docker/gluetun.env.example` | Modify | 8 |
