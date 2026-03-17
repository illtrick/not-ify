# Casting to Network Devices — Future Plan

## Context
After reviewing [Music Assistant](https://github.com/music-assistant), we identified a casting architecture for Not-ify. This plan is saved for future implementation.

Music Assistant is a massive Python/asyncio project with 10+ casting protocols (AirPlay 1&2, Chromecast, DLNA, Sonos, HEOS, Snapcast, Bluesound). Their code is Python-specific and not directly portable, but their **architecture patterns** (device discovery → player abstraction → stream routing) are worth replicating in Node.js using equivalent npm packages.

### Scope: Start with DLNA + Chromecast
- **DLNA/UPnP**: Covers most smart TVs, receivers, speakers (Samsung, LG, Sony, Denon, etc.)
- **Chromecast**: Covers Google/Nest speakers, Chromecast dongles, Android TVs
- **AirPlay**: Defer to Phase 2 — requires RAOP protocol complexity, pairing, encryption. The npm `airtunes2` package exists but is less mature.

These two protocols cover ~80% of home casting devices with well-maintained npm libraries.

---

## Dependencies

```
npm install castv2-client                 # Chromecast CASTV2 protocol
npm install bonjour                       # mDNS/Zeroconf discovery (pure JS, no native deps)
npm install node-ssdp                     # SSDP/UPnP discovery
npm install upnp-mediarenderer-client     # DLNA MediaRenderer control
```

## `server/src/services/casting.js` — Device Discovery & Management

Central casting service that discovers and manages network players.

**Discovery** (runs on server start, re-scans on demand):
- **mDNS** via `bonjour`: Browse `_googlecast._tcp` for Chromecast devices
- **SSDP** via `node-ssdp`: Search `urn:schemas-upnp-org:device:MediaRenderer:1` for DLNA devices
- Maintain a `Map<deviceId, DeviceInfo>` of discovered devices
- Emit events when devices appear/disappear (for SSE to clients)

**DeviceInfo shape:**
```js
{
  id: 'uuid-or-mac',
  name: 'Living Room TV',
  type: 'chromecast' | 'dlna',
  host: '192.168.1.50',
  port: 8009,
  status: 'idle' | 'playing' | 'paused',
  currentTrack: null,
  volume: 0.5,
}
```

**Playback control interface** (uniform across protocols):
```js
async play(deviceId, streamUrl, metadata)  // Load + play
async pause(deviceId)
async resume(deviceId)
async stop(deviceId)
async seek(deviceId, positionSec)
async setVolume(deviceId, level)           // 0.0-1.0
```

**Chromecast implementation** (via `castv2-client`):
- Connect to device, launch DefaultMediaReceiver
- Load stream URL with metadata (title, artist, cover art URL)
- The server's `/api/stream/:id` and `/api/yt/stream/:videoId` endpoints already serve audio over HTTP — Chromecast can consume these directly if the URL is reachable on the LAN

**DLNA implementation** (via `upnp-mediarenderer-client`):
- Set AVTransport URI to stream URL
- Send Play/Pause/Stop/Seek SOAP actions
- Same stream URLs work — DLNA devices fetch audio via HTTP

**Key insight from Music Assistant**: The server must expose its stream URLs using the **server's LAN IP** (not `localhost`), since casting devices fetch audio from the server over the network. Add a utility to detect the server's LAN IP (e.g., `os.networkInterfaces()`).

## `server/src/api/cast.js` — REST API

```
GET  /api/cast/devices           — List discovered devices
POST /api/cast/play              — { deviceId, trackId?, ytVideoId?, url? }
POST /api/cast/pause             — { deviceId }
POST /api/cast/resume            — { deviceId }
POST /api/cast/stop              — { deviceId }
POST /api/cast/volume            — { deviceId, level }
POST /api/cast/seek              — { deviceId, position }
GET  /api/cast/devices/stream    — SSE: real-time device list updates
```

The `/api/cast/play` endpoint:
1. Resolves track to a full stream URL using the server's LAN IP
2. Builds metadata (title, artist, album, cover art URL)
3. Calls `castingService.play(deviceId, streamUrl, metadata)`

## Client-Side Cast UI

**Device picker** (cast button in player bar):
- Small cast icon (📡) next to volume controls
- On click: dropdown/modal listing discovered devices with type icons
- Selected device highlighted; click to cast current track
- "This device" option to switch back to browser playback

**Cast mode behavior**:
- When casting, the browser `<audio>` element is paused/muted
- Player bar shows cast device name: "Playing on Living Room TV"
- Play/pause/next/prev controls send commands to `/api/cast/*` instead of controlling `<audio>`
- Progress bar updates via polling device status (every 2-3s)
- Volume slider controls cast device volume

**State additions:**
```js
const [castDevices, setCastDevices] = useState([]);
const [activeCastDevice, setActiveCastDevice] = useState(null);
const [castStatus, setCastStatus] = useState(null); // { position, duration, state }
```

## Stream URL Resolution

Casting devices need to reach the server over the network. The server needs to:
1. Detect its own LAN IP via `os.networkInterfaces()`
2. Construct URLs like `http://192.168.1.100:3000/api/stream/{trackId}`
3. For YouTube streams: proxy through the server (already done via `/api/yt/stream/:videoId`)

Add `GET /api/server-info` → `{ lanIp, port }` so the client can construct cast-compatible URLs if needed.

---

## Docker Networking Consideration

**Critical**: mDNS and SSDP use multicast UDP (224.0.0.251:5353 and 239.255.255.250:1900). In Docker's default bridge network, multicast traffic doesn't reach the container. Two options:

1. **`network_mode: host`** — simplest, container shares host's network stack. mDNS/SSDP just work. Downside: port 3000 binds directly on host (already the case with port mapping).
2. **macvlan network** — gives container its own IP on the LAN. More complex setup.

**Recommendation**: Use `network_mode: host` for simplicity. The app already maps port 3000; host networking just removes the NAT layer.

---

## Music Assistant Architecture Notes (for reference)

**Multi-Protocol Linking**: MA auto-merges protocol players for same physical device (e.g., a Samsung TV discovered via both Chromecast and DLNA becomes one "Samsung TV" with selectable output protocol). Matching uses MAC address priority.

**AirPlay details** (for Phase 2):
- mDNS discovery via `_airplay._tcp` and `_raop._tcp`
- HAP pairing (HomeKit Accessory Protocol) for Apple device auth
- NTP-based multi-room sync
- Flow mode: streams entire queue as continuous audio for gapless playback
- npm packages: `airtunes2` (RAOP sender), `@lox-audioserver/node-airplay-sender` (TypeScript, RAOP + AirPlay 2)

**Key npm libraries**:
- [castv2-client](https://github.com/thibauts/node-castv2-client) — Chromecast
- [bonjour](https://www.npmjs.com/package/bonjour) — mDNS discovery
- [node-ssdp](https://github.com/bazwilliams/node-ssdp) — SSDP/UPnP discovery
- [upnp-mediarenderer-client](https://github.com/thibauts/node-upnp-mediarenderer-client) — DLNA control
- [airtunes2](https://www.npmjs.com/package/airtunes2) — AirPlay/RAOP (Phase 2)

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `server/src/services/casting.js` | **Create** | Device discovery (mDNS + SSDP), Chromecast + DLNA playback control |
| `server/src/api/cast.js` | **Create** | REST endpoints for cast control + SSE device stream |
| `server/src/index.js` | Modify | Mount cast router, start discovery on boot, add `/api/server-info` |
| `server/package.json` | Modify | Add `castv2-client`, `bonjour`, `node-ssdp`, `upnp-mediarenderer-client` |
| `client/src/App.jsx` | Modify | Cast button + device picker, cast mode controls |
| `docker-compose.yml` | Modify | Add `network_mode: host` |

## Verification
1. `docker compose up --build` with `network_mode: host`
2. Open Not-ify → check cast icon appears in player bar
3. Click cast icon → verify discovered devices listed
4. Cast a library track → verify audio plays on the target device with correct metadata
5. Cast a YouTube track → verify proxied stream works on cast device
6. Test play/pause/volume/seek controls while casting
7. Switch back to "This device" → verify browser playback resumes
