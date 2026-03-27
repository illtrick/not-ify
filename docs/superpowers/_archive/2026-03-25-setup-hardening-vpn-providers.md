# Setup Hardening + Multi-VPN Provider Support

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Make the first-time setup → Settings UI → service configuration flow reliable for any user. Add formal multi-VPN provider support.

**Root cause:** Settings UI saves to the not-ify DB and pushes to service APIs at runtime, but does NOT update `.env` files or restart containers. When containers restart (watchtower, manual, crash), they revert to the original `.env` values. This breaks VPN and Soulseek after any container restart.

---

## Architecture Change

**Current flow (broken):**
```
User → Settings UI → saves to DB → pushes to service API → works until restart → reverts
```

**New flow:**
```
User → Settings UI → saves to DB → writes to .env → restarts container via Docker socket → persistent
```

The not-ify container needs Docker socket access (`/var/run/docker.sock`) to restart sibling containers. This is already available in the compose template for setup, just needs to be added to the running container.

---

## Phase 1: Docker Socket + Container Restart API

### Task 1: Add Docker socket to not-ify container in compose template

**Files:**
- Modify: `scripts/docker-compose.template.yml`

- [ ] Add Docker socket volume mount to not-ify service:
```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock:ro
```
- [ ] Add `INSTALL_DIR` env var so the server knows where `.env` lives:
```yaml
  - INSTALL_DIR=${INSTALL_DIR:-/opt/not-ify}
```

### Task 2: Create container management service

**Files:**
- Create: `packages/server/src/services/container-manager.js`
- Create: `packages/server/__tests__/services/container-manager.test.js`

Provides functions to:
- [ ] `restartContainer(name)` — restart a sibling container via Docker socket
- [ ] `updateEnvFile(key, value)` — read `.env`, update/add a key, write back
- [ ] `updateEnvFileMulti(updates)` — batch update multiple keys
- [ ] `getContainerStatus(name)` — check if container is running/healthy

Uses Docker Engine API via Unix socket (`/var/run/docker.sock`):
- `POST /containers/{name}/restart` for restart
- `GET /containers/{name}/json` for status

The `.env` file path is `${INSTALL_DIR}/.env` (from env var) or falls back to `/app/config/../.env` (relative to config dir).

### Task 3: Create server API for container management

**Files:**
- Create: `packages/server/src/api/containers.js`
- Modify: `packages/server/src/index.js` (mount route)

- [ ] `POST /api/containers/:name/restart` — admin-only, restarts a named container
- [ ] `GET /api/containers/status` — returns status of all known containers (not-ify, slskd, gluetun, clamav, watchtower)
- [ ] Container names are whitelisted — only allow restarting known services

---

## Phase 2: Settings UI → .env → Container Restart

### Task 4: Update Soulseek config to persist + restart

**Files:**
- Modify: `packages/server/src/api/soulseek-config.js`

- [ ] After saving to DB and pushing to slskd API, also:
  1. Call `updateEnvFileMulti({ SLSKD_SLSK_USERNAME: username, SLSKD_SLSK_PASSWORD: password })`
  2. Call `restartContainer('slskd')` if the API push failed (container will pick up from .env on restart)
- [ ] Return `{ saved: true, persistent: true }` to indicate .env was updated

### Task 5: Update VPN config to persist + restart

**Files:**
- Modify: `packages/server/src/api/vpn.js` (or wherever VPN config is saved)

- [ ] After saving to DB, also:
  1. Call `updateEnvFileMulti({ VPN_USERNAME: username, VPN_PASSWORD: password, VPN_REGION: region, VPN_PROVIDER: provider })`
  2. Call `restartContainer('gluetun')`
- [ ] Wait up to 30s for gluetun to become healthy, then auto-test connection
- [ ] Return `{ saved: true, persistent: true, vpnConnected: bool }`

### Task 6: Update bootstrap.sh to prompt for credentials

**Files:**
- Modify: `scripts/bootstrap.sh`

- [ ] When VPN is enabled, prompt for:
  - VPN provider (dropdown/numbered list of top providers)
  - Username
  - Password
  - Region (default per provider)
- [ ] Pass credentials to setup.sh via env vars: `NOTIFY_VPN_PROVIDER`, `NOTIFY_VPN_USERNAME`, `NOTIFY_VPN_PASSWORD`, `NOTIFY_VPN_REGION`
- [ ] When Soulseek is always-on, prompt:
  - "Do you have a Soulseek account? [Y/n]"
  - If yes: prompt username + password
  - If no: explain they can create one at slsknet.org or configure later in Settings
- [ ] Pass to setup.sh: `NOTIFY_SLSK_USERNAME`, `NOTIFY_SLSK_PASSWORD`

### Task 7: Update setup.sh to use prompted credentials

**Files:**
- Modify: `scripts/setup.sh`

- [ ] Read `NOTIFY_VPN_*` and `NOTIFY_SLSK_*` env vars
- [ ] Write to `.env` with real creds instead of empty/auto-generated
- [ ] If slskd creds are empty (user said "configure later"), use `SLSKD_NO_CONNECT=true` env var to start slskd without attempting network connection

---

## Phase 3: Multi-VPN Provider Support

### Task 8: Add VPN provider data model

**Files:**
- Create: `packages/server/src/services/vpn-providers.js`
- Create: `packages/server/__tests__/services/vpn-providers.test.js`

Static data for supported providers:

```javascript
const PROVIDERS = [
  { id: 'private internet access', label: 'Private Internet Access (PIA)', protocol: 'openvpn', regions: ['US East', 'US West', 'US Las Vegas', 'US California', 'UK London', 'Netherlands', 'Germany', 'Japan', 'Australia'] },
  { id: 'nordvpn', label: 'NordVPN', protocol: 'openvpn', regions: ['United States', 'United Kingdom', 'Netherlands', 'Germany', 'France', 'Japan', 'Australia'] },
  { id: 'surfshark', label: 'Surfshark', protocol: 'openvpn', regions: ['us-nyc', 'us-lax', 'uk-lon', 'nl-ams', 'de-fra'] },
  { id: 'mullvad', label: 'Mullvad', protocol: 'wireguard', regions: ['us-nyc', 'us-lax', 'gb-lon', 'nl-ams', 'de-fra'] },
  { id: 'protonvpn', label: 'ProtonVPN', protocol: 'openvpn', regions: ['US', 'UK', 'Netherlands', 'Germany', 'Japan'] },
  { id: 'expressvpn', label: 'ExpressVPN', protocol: 'openvpn', regions: ['USA - New York', 'USA - Los Angeles', 'UK - London', 'Netherlands', 'Germany'] },
  { id: 'ivpn', label: 'IVPN', protocol: 'wireguard', regions: ['us-nj', 'us-ca', 'gb', 'nl', 'de'] },
  { id: 'windscribe', label: 'Windscribe', protocol: 'wireguard', regions: ['US East', 'US West', 'UK', 'Netherlands', 'Germany'] },
  { id: 'cyberghost', label: 'CyberGhost', protocol: 'openvpn', regions: ['US', 'UK', 'Germany', 'Netherlands', 'France'] },
  { id: 'torguard', label: 'TorGuard', protocol: 'openvpn', regions: ['US-NEWYORK', 'US-LOSANGELES', 'UK-LONDON', 'NETHERLANDS', 'GERMANY'] },
];
```

- [ ] `getProviders()` — returns list of providers with labels and regions
- [ ] `getProviderRegions(providerId)` — returns region list for a provider
- [ ] `getGluetunEnvVars(provider, username, password, region)` — returns the correct env var mapping for gluetun (different providers use different env var patterns)

Region lists are intentionally small (5-10 per provider) — curated popular locations, not exhaustive. Users can enter custom region names if needed.

### Task 9: Add VPN provider API endpoint

**Files:**
- Modify: `packages/server/src/api/vpn.js`

- [ ] `GET /api/vpn/providers` — returns provider list with regions
- [ ] Update `POST /api/vpn/config` to accept `provider` field
- [ ] Update `POST /api/vpn/region` to validate region against provider's list

### Task 10: Update Settings UI for multi-provider VPN

**Files:**
- Modify: `packages/client/src/components/SettingsModal.jsx`

- [ ] Replace hardcoded "PIA" section with dynamic provider selector:
  - Provider dropdown (loads from `/api/vpn/providers`)
  - Username field (label changes per provider — some use email, some use account ID)
  - Password field
  - Region dropdown (populated from selected provider's regions)
- [ ] On provider change, update region dropdown options
- [ ] On Save: sends `{ provider, username, password, region }` → server updates .env + restarts gluetun
- [ ] Show connection status with real IP and location after save

### Task 11: Update bootstrap.sh VPN prompt for multi-provider

**Files:**
- Modify: `scripts/bootstrap.sh`

- [ ] When VPN is enabled, show numbered provider list:
```
  VPN Providers:
    [1] Private Internet Access (PIA)
    [2] NordVPN
    [3] Surfshark
    [4] Mullvad
    [5] ProtonVPN
    [6] ExpressVPN
    [7] Other (enter gluetun provider name)
```
- [ ] After provider selection, prompt for username + password
- [ ] Show default region, allow override

---

## Phase 4: Verification

### Task 12: End-to-end testing

- [ ] Clean install via bootstrap.sh with VPN + Soulseek creds entered during setup
  - Verify gluetun connects on first boot
  - Verify slskd connects on first boot
  - Verify upgrade pipeline works (torrent via VPN + soulseek)
- [ ] Change VPN credentials in Settings UI
  - Verify gluetun restarts with new creds
  - Verify VPN connects with new provider/region
- [ ] Change Soulseek credentials in Settings UI
  - Verify slskd reconnects with new creds
  - Verify creds persist across slskd container restart
- [ ] Watchtower upgrade scenario
  - Simulate container restart
  - Verify all creds survive restart (read from .env, not just runtime state)

---

## Integration Checklist

| Component | Reads creds from | Persists to | Restart trigger |
|-----------|-----------------|-------------|-----------------|
| slskd | .env (SLSKD_SLSK_*) | .env + DB | Docker socket restart |
| gluetun | .env (VPN_*) | .env + DB | Docker socket restart |
| clamav | No creds needed | N/A | N/A |
| not-ify | DB (global_settings) | DB | process.exit(0) |

## Notes

- Docker socket in not-ify container is read-only (`:ro`) — can restart containers but can't create new ones
- Container restart takes 5-15s. UI should show a progress indicator.
- If Docker socket is not available (dev mode), skip container restart and log a warning
- The `.env` file is the single source of truth for container config. DB is the source of truth for UI state. Both are updated simultaneously.
- VPN provider region lists are curated, not exhaustive. Add a "Custom" option for power users.

## Gluetun Supported Providers

Full list from [gluetun docs](https://github.com/qdm12/gluetun): AirVPN, CyberGhost, ExpressVPN, FastestVPN, Giganews, HideMyAss, IPVanish, IVPN, Mullvad, NordVPN, Perfect Privacy, PIA, Privado, Private Internet Access, PrivateVPN, ProtonVPN, PureVPN, SlickVPN, Surfshark, TorGuard, VPN Unlimited, VPNSecure, VyprVPN, Windscribe.

We support the top 10 most popular providers in the UI, with a "Custom" option for the rest.
