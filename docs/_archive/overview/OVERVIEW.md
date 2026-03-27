# Not-ify — Functional & Architectural Overview

**Version:** 1.6.0
**Last updated:** 2026-03-23

---

## What Is Not-ify?

Not-ify is a **self-hosted music application** for personal music collections. Think Spotify, but you own the server, the library, and the pipeline that builds it.

It runs on a home NAS (or any Docker host), discovers music from multiple sources, downloads it through a privacy-aware pipeline, organizes it into a searchable library, and plays it back through web browsers, desktop apps, or DLNA speakers like Sonos and WiiM.

---

## Core Capabilities

### 1. Multi-Source Music Search

Not-ify searches across four sources simultaneously and ranks results by relevance, quality, and listening history:

| Source | What It Provides | Quality |
|--------|-----------------|---------|
| **MusicBrainz** | Canonical metadata — artist, album, year, track listings, MBIDs | Metadata only |
| **ApiBay** | Torrent magnet links (via Real-Debrid for fast download) | FLAC, MP3, mixed |
| **Soulseek** | Peer-to-peer file sharing (via slskd sidecar) | Often FLAC |
| **YouTube** | Streaming audio + downloadable tracks | Lossy (best available) |

**Search ranking** uses token matching (artist + album words), format quality weighting (FLAC > WAV > M4A > MP3), seeder counts, and recently-played history injection.

An optional **LLM** (Ollama, qwen3:4b) expands search queries into 3–5 variations to catch alternate spellings and editions.

### 2. Acquisition Pipeline

The download pipeline handles the full lifecycle from magnet link to organized library file:

```
Search Result
  → Real-Debrid (unrestrict torrent → direct HTTP link)
  → Downloader (stream to disk, extract archives)
  → File Validator (MIME check, ffprobe, optional ClamAV malware scan)
  → Download Validator (match tracks against MusicBrainz release)
  → Library Import (organize into Artist/Album/Track structure)
```

**Soulseek pipeline** follows a similar path but downloads directly from peers via slskd.

**YouTube pipeline** uses yt-dlp to extract audio and save to the library.

All downloads are routed through a **persistent job queue** (SQLite-backed) with retry logic, deduplication, and priority scheduling.

### 3. Quality Upgrader

A background service scans the library for low-quality albums and automatically searches for better versions:

| Rank | Formats |
|------|---------|
| 5 (best) | FLAC |
| 4 | WAV, ALAC |
| 3 | M4A |
| 2 | OGG, OPUS, AAC |
| 1 (worst) | MP3 |

Albums below a configurable threshold are queued for upgrade. The upgrader runs on a 6-hour schedule or on-demand.

### 4. Library Management

- Filesystem-backed with SQLite metadata index
- Artist → Album → Track hierarchy
- Per-track metadata: format, bitrate, duration, file size, MusicBrainz IDs
- Soft-delete for individual tracks (`.metadata.json` exclusion)
- Hard-delete for albums (removes files)
- Cover art from iTunes and Deezer APIs (~73% success rate)

### 5. Playback

**Web/Desktop playback:**
- HTML5 Audio with gapless crossfade (configurable duration)
- Dual audio element pre-buffering (current + next track)
- Queue management with drag-drop reorder
- Auto-advance on error (skips deleted/corrupted tracks)

**DLNA casting (v2):**
- Automatic device discovery via SSDP (re-scan every 60s)
- Sonos: native queue via `AddURIToQueue` with Rincon namespace
- WiiM: Linkplay `PlayQueue` extension
- Generic UPnP: `SetAVTransportURI` with DIDL-Lite metadata
- Transport controls: play, pause, stop, seek, volume, next, previous
- HMAC-signed streaming URLs for device authentication

### 6. Last.fm Integration

- Per-user authentication (API key + session key)
- Real-time scrobbling with now-playing updates
- Scrobble queue with auto-flush (survives restarts)
- Bulk history import
- Top artists/tracks for personalized recommendations

### 7. Multi-User Support

- SQLite-based user sessions (not JWT — local network trust model)
- Per-user: recently played, search history, favorites, playlists, settings, Last.fm config
- First user auto-promoted to admin
- Admin-only endpoints: service config (RD, VPN, Soulseek), server restart, diagnostics

### 8. Privacy & VPN

- Gluetun sidecar (PIA OpenVPN + DNS-over-TLS)
- Selective proxy routing:
  - **Through VPN:** ApiBay search, Real-Debrid API
  - **Direct:** YouTube (blocks VPN IPs), MusicBrainz, Last.fm
- Region switching via Gluetun control API

---

## Architecture

### Monorepo Structure

```
not-ify/
├── packages/
│   ├── server/        Express.js backend (Node 20)
│   ├── client/        React web UI (Vite)
│   ├── shared/        Isomorphic API client
│   └── desktop/       Tauri 2 desktop app (scaffold)
├── docker/
│   ├── Dockerfile         Multi-stage production build
│   └── Dockerfile.dev     Dev with nodemon + hot reload
├── docker-compose.yml         Base services
├── docker-compose.dev.yml     Dev overrides (slskd, Ollama)
├── docker-compose.prod.yml    QNAP production overrides
└── .github/workflows/
    ├── ci.yml                 Test → E2E → push image → release
    └── release-desktop.yml    Tauri builds on tags
```

### Server Services

| Service | Responsibility |
|---------|---------------|
| `db.js` | SQLite (WAL mode), 13 tables, auto-migration |
| `musicbrainz.js` | Release/artist search, track listings, SQLite cache |
| `search.js` | ApiBay torrent search (multi-strategy, SOCKS5 proxy) |
| `soulseek.js` | slskd REST client, 9-query cascade (94% hit rate) |
| `youtube.js` | yt-dlp subprocess — search + stream extraction |
| `search-ranking.js` | Token-based scoring, quality weighting, history injection |
| `realdebrid.js` | Torrent-to-HTTP conversion, file selection |
| `downloader.js` | HTTP stream-to-disk, archive extraction (ZIP/RAR) |
| `file-validator.js` | MIME check, ffprobe, ClamAV (optional) |
| `download-validator.js` | MusicBrainz track matching + confidence scoring |
| `job-queue.js` | Persistent SQLite queue (priority, retry, dedup) |
| `job-worker.js` | Dequeue → execute → mark done/failed |
| `quality-upgrader.js` | Library scan → upgrade job creation |
| `dlna.js` | SSDP discovery, SOAP control, Sonos/WiiM/generic |
| `cast-session.js` | Per-user cast state (volatile, in-memory) |
| `stream-auth.js` | HMAC-signed URLs for DLNA devices |
| `lastfm.js` | Scrobble, now-playing, history import |
| `llm.js` | Ollama client, query expansion, disk cache |
| `proxy.js` | SOCKS5 proxy wrapper for VPN-routed calls |
| `activity-log.js` | Event bus + SSE broadcast |
| `diagnostics.js` | Service health aggregation |

### API Surface

| Area | Key Endpoints |
|------|--------------|
| **Search** | `GET /api/search`, `GET /api/mb/release/:mbid/tracks`, `GET /api/yt/search` |
| **Library** | `GET /api/library`, `GET /api/stream/:id`, `DELETE /api/library/album` |
| **Pipeline** | `POST /api/download`, `POST /api/download/yt`, `POST /api/download/background` |
| **Upgrade** | `POST /api/upgrade/scan`, `GET /api/upgrade/status` |
| **Cast** | `GET /api/cast/devices`, `POST /api/cast/play`, `POST /api/cast/pause`, etc. |
| **Last.fm** | `POST /api/lastfm/scrobble`, `POST /api/lastfm/nowplaying` |
| **Config** | `POST /api/realdebrid/config`, `POST /api/vpn/config`, `POST /api/soulseek/config` |
| **Admin** | `GET /api/health/services`, `GET /api/diagnostics`, `POST /api/server/restart` |
| **User Data** | `GET /api/recently-played`, `GET /api/favorites`, `GET /api/session` |

### Client Architecture

- **App.jsx** — Orchestration shell (4000 lines, planned refactor)
- **22+ components** — SearchView, AlbumView, ArtistView, PlayerBar, QueuePanel, CastButton, SettingsModal, DownloadIndicator, ActivityLog, QualityBadge, MobileLibrary, etc.
- **13+ hooks** — useSearch, usePlayer, useQueue, useCast, useDownload, useLibrary, useLastFm, useRecentlyPlayed, useMbTracks, useArtistPage, etc.
- **Responsive:** Desktop sidebar + Mobile bottom tab bar (768px breakpoint)

### Shared Package

Isomorphic fetch wrapper (`api-client.js`) that works in web (relative URLs), Tauri desktop (absolute server URL), and future React Native:

- `configure({ baseUrl, onVersionMismatch })` — environment setup
- `get/post/put/del` — typed HTTP methods with user injection
- `rawPost/rawGet` — SSE streaming support
- Convenience wrappers for every API endpoint

### Desktop App (Tauri 2)

Status: **scaffold only**. Window configured (1200x800), auto-update from GitHub releases, but full integration pending.

---

## Data Model

### Key Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `users` | User accounts | id, display_name, role (admin\|user) |
| `tracks` | Library index | id, artist, album, title, format, filepath |
| `recently_played` | Listening history | user_id, artist, album, mbid, played_at |
| `favorites` | Saved tracks | user_id, track_id, artist, title |
| `playlists` / `playlist_tracks` | User playlists | name, track ordering |
| `user_session` | Queue + playback state | queue (JSON), state (JSON) |
| `lastfm_config` | Per-user Last.fm auth | api_key, session_key, username |
| `lastfm_scrobble_queue` | Pending scrobbles | artist, track, timestamp |
| `jobs` | Persistent job queue | type, status, payload, retries, dedupe_key |
| `job_log` | Download history | outcome, quality, duration, fail_reason |
| `global_settings` | App-wide config | key-value (RD token, VPN config, etc.) |
| `mb_cache` | MusicBrainz cache | key, data (JSON), expires_at, hit_count |
| `scrobbles` | Play history | user_id, artist, track, played_at |
| `artist_affinity` | Listening patterns | user_id, artist, play_count |

Design: **SQLite WAL mode**, foreign keys with cascade deletes, strategic indexes on user+time columns, JSON blobs for flexible payloads.

---

## External Dependencies

| Dependency | Type | Purpose | Required? |
|-----------|------|---------|-----------|
| **MusicBrainz** | API | Metadata, track listings | Yes |
| **Real-Debrid** | API | Torrent → HTTP conversion | For torrent downloads |
| **slskd** | Docker sidecar | Soulseek peer-to-peer | For Soulseek downloads |
| **yt-dlp** | Binary | YouTube audio extraction | For YouTube features |
| **Gluetun** | Docker sidecar | VPN (PIA OpenVPN) | Optional (privacy) |
| **Ollama** | Docker sidecar | LLM query expansion | Optional (search enhancement) |
| **ClamAV** | Docker sidecar | Malware scanning | Optional (security) |
| **Last.fm** | API | Scrobbling, recommendations | Optional |
| **iTunes/Deezer** | API | Cover art search | Optional (art fetching) |

---

## Deployment

### One-Command Setup (v1.6.0+)

```bash
docker run --rm -it \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /:/host:ro \
  ghcr.io/illtrick/not-ify:latest setup
```

The setup script detects your platform (QNAP, Synology, or generic Linux), helps you select a music library folder, generates all configuration, starts the containers, and prints the URL. A web-based first-run wizard then guides account creation and service configuration.

### Environments

| Env | Host | Port | Update Strategy |
|-----|------|------|----------------|
| **Dev** | Windows laptop | 3000 (server), 5173 (Vite) | Native npm scripts |
| **Staging** | QNAP NAS | 3001 | Watchtower auto-pull `latest` |
| **Production** | QNAP NAS | 3000 | Pinned version tag, manual update |

### CI/CD Pipeline

```
Push to main → Test (Jest + Vitest) → E2E (Playwright) → Build + Push Docker image → Watchtower → Staging

Tag v*.*.* → All above + GitHub Release + Tauri desktop builds
```

### First-Run Wizard

On first launch (empty database), the app shows a setup wizard instead of the login screen:

1. **Create account** — display name, auto-admin
2. **Confirm music library** — validate path, show free space
3. **Optional services** — Last.fm, Real-Debrid, VPN, Soulseek (skip any)
4. **Service dashboard** — green/yellow status for all services

### Environment Variables

Key configuration (all optional — the setup script generates these):

```
PORT, NODE_ENV, LOG_LEVEL, CONFIG_DIR, MUSIC_DIR
SLSKD_URL, SLSKD_API_KEY, SLSKD_DOWNLOADS_DIR
DLNA_ENABLED
```

Credentials (Last.fm, Real-Debrid, VPN, Soulseek) are stored in the SQLite database, not environment variables. Configure them through the web UI.

---

## Key Architectural Decisions

1. **SQLite over PostgreSQL** — Single-file DB, no external service, ideal for home server
2. **Job queue in SQLite** — Persistent, survives restarts, no Redis dependency
3. **Selective VPN routing** — Privacy for torrents, direct for YouTube (blocks VPN IPs)
4. **LLM as optional enhancer** — Regex fallback when Ollama unavailable
5. **DLNA over proprietary protocols** — Standard UPnP works with Sonos, WiiM, any renderer
6. **Local network trust model** — X-User-Id header, no JWT/OAuth (home network assumption)
7. **Monorepo with shared API client** — Single version, unified CI, isomorphic fetch
8. **WAL mode SQLite** — Concurrent reads + writes without blocking
9. **HMAC-signed stream URLs** — Secure device access without session cookies

---

## Current Status

### Done
- Multi-source search with ranking
- Full acquisition pipeline (torrent + YouTube + Soulseek)
- Persistent job queue with retry
- Quality upgrader (automatic library improvement)
- File + download validation
- DLNA v2 casting (Sonos, WiiM, generic)
- Multi-user with per-user data
- Last.fm integration
- VPN infrastructure
- LLM-enhanced search
- Cover art (iTunes + Deezer)
- Mobile responsive UI
- Activity logging
- Admin controls
- CI/CD with E2E tests

### In Progress
- Desktop app (Tauri 2 — scaffold exists)
- Cover art gap (~40% missing)
- App.jsx refactor (4000 lines)

### Future
- iOS/Android app (React Native)
- Offline sync
- Subsonic API compatibility (not planned — custom apps only)
