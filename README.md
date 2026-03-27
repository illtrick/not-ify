# Not-ify

Self-hosted music platform. Search, download, upgrade, and play — all from your own server.

Not-ify discovers music from multiple sources (MusicBrainz, torrents, Soulseek, YouTube), downloads through a quality-aware pipeline, and plays back through your browser or DLNA speakers like Sonos and WiiM.

## Quick Start

```bash
curl -sL https://raw.githubusercontent.com/illtrick/not-ify/main/scripts/bootstrap.sh | bash
```

The setup script runs directly on your machine, detects your platform (QNAP, Synology, or any Linux with Docker), helps you choose a music folder, then launches Not-ify in Docker. A first-run wizard in the browser walks you through account creation and service configuration.

**Requirements:** Docker with Compose plugin (Docker 23.0+ or Docker Desktop).

## What It Does

- **Search** across MusicBrainz, torrent indexes, Soulseek peers, and YouTube simultaneously
- **Download** via Real-Debrid (torrents) or directly from Soulseek peers
- **Auto-upgrade** — plays music immediately from YouTube, then upgrades to higher quality in the background
- **Per-track quality management** — upgrades individual tracks, not entire albums. Keeps what's better, skips what's not
- **DLNA casting** to Sonos, WiiM, and generic UPnP speakers
- **Last.fm scrobbling** with full history sync and library import from listening history
- **Privacy-first** — optional VPN sidecar (PIA via Gluetun) for torrent traffic
- **Multi-user** with admin controls for service configuration

## Architecture

```
┌─────────────┐     ┌──────────┐     ┌──────────┐
│   Browser   │────▶│ Not-ify  │────▶│  slskd   │
│  React SPA  │     │  Server  │     │ Soulseek │
└─────────────┘     └────┬─────┘     └──────────┘
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
         ┌────────┐ ┌────────┐ ┌────────┐
         │ SQLite │ │ yt-dlp │ │  Real  │
         │   DB   │ │YouTube │ │ Debrid │
         └────────┘ └────────┘ └────────┘
```

**Monorepo** with npm workspaces: `packages/server` (Express + SQLite), `packages/client` (React + Vite), `packages/shared` (API client), `packages/desktop` (Tauri scaffold).

## Services

| Service | Purpose | Required |
|---------|---------|----------|
| **Not-ify** | Main app — search, download, library, playback | Yes |
| **slskd** | Soulseek peer-to-peer music sharing | No (upgrades only) |
| **Watchtower** | Auto-updates containers | No (recommended) |
| **Gluetun** | VPN sidecar for private downloads | No |

## Configuration

All credentials are configured through the web UI (Settings page). The setup script generates the infrastructure config:

```
<install-dir>/
├── docker-compose.yml    # Generated — services, volumes, ports
├── .env                  # Defaults — PORT, NODE_ENV, LOG_LEVEL
├── .env.local            # Instance — MUSIC_DIR, CONFIG_DIR, API keys
├── config/
│   └── notify.db         # SQLite — users, creds, scrobbles, library
├── slskd/
│   └── slskd.yml         # Soulseek config with API key
└── slskd-downloads/      # Shared volume for Soulseek transfers
```

## Development

```bash
# Native dev (recommended)
npm install
npm run dev:server    # Express on :3000
npm run dev:client    # Vite on :5173

# Or use the dev manager (Windows)
dev.bat start         # Starts all services
dev.bat status        # Health check everything
dev.bat stop          # Clean shutdown
```

**Tests:**
```bash
npm test                      # All tests
npm test --prefix packages/server  # Server only (550+ tests)
```

## Recent Changes

**v1.7.13** — YT download reliability (concurrency tuning, per-track retry), VPN credential lifecycle fixes, Soulseek config seeding

**v1.7.12** — 16 bug fixes across player, badges, data integrity, pipeline, and health dashboard

**v1.7.9** — ClamAV scan policy, bootstrap UX improvements, metadata architecture redesign

**v1.6.0** — First-run setup wizard, one-command Docker install

See [CHANGELOG.md](CHANGELOG.md) for full history.

## License

MIT
