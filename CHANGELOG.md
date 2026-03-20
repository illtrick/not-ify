# Changelog

All notable changes to Not-ify are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/). Versioning follows [Semantic Versioning](https://semver.org/).

- **MAJOR** (x.0.0): Breaking changes to API, data formats, or deployment
- **MINOR** (0.x.0): New features, meaningful improvements
- **PATCH** (0.0.x): Bug fixes, polish, iteration on current features

## [1.2.1] - 2026-03-20

### Fixed
- Restored RealDebrid VPN proxy routing — VPN tester confirmed no IP blocking across 7 regions
- YouTube yt-dlp correctly bypasses VPN (stream extraction blocked on 5/7 VPN regions, search unaffected)
- Gluetun control API auth: disabled default auth config to enable region switching
- Region switching uses correct gluetun endpoint (`/v1/vpn/settings` with nested provider payload)
- QNAP staging volumes use absolute `/share/CACHEDEV1_DATA/` paths (prevents 16MB tmpfs issue)
- Settings UI: merged Save and Switch Region into single Save button

### Changed
- VPN routing policy (test-validated): ApiBay + RealDebrid + downloads through VPN; YouTube direct

## [1.1.1] - 2026-03-19

### Added
- Admin role system: first user auto-promoted to admin, role column on users table
- Real-Debrid config UI with token input and connection testing (admin only)
- VPN (PIA) config UI with region selector and proxy connectivity test (admin only)
- Admin guard middleware for sensitive config endpoints
- Generic `useServiceConfig` hook for service config load/save/test pattern

### Changed
- Real-Debrid token storage migrated from config/settings.json to SQLite global_settings
- Settings modal now shows service sections based on user role
- VPN credentials stored in SQLite (plaintext — acceptable for home network)

## [1.1.0] - 2026-03-19

### Added
- **Acquisition pipeline**: File validation (MIME check, ffprobe, ClamAV, size limits) for all downloads
- **Job queue**: Persistent SQLite-backed background task queue replacing in-memory downloads
- **Quality upgrader**: Scans library for low-quality tracks, finds better sources, idle scheduling
- **VPN infrastructure**: Gluetun sidecar with PIA OpenVPN + DNS-over-TLS for yt-dlp/torrent traffic
- **ClamAV integration**: Optional malware scanning via Docker sidecar (`security` profile)
- **Client upgrade UI**: Per-album "Upgrade to FLAC" button, job queue status display
- **API client methods**: `getJobQueue()`, `triggerAlbumUpgrade()`, `triggerLibraryScan()`

### Fixed
- Quality badges now show correctly in MusicBrainz track view (normalized title matching)
- yt-dlp audio quality restored to best (0) — was incorrectly changed to 5
- Auto-acquire now falls back to YouTube when torrent path fails
- Removed dead TrackStatusIcon import and vestigial add-to-queue button
- Root package.json version synced with sub-packages

### Changed
- Torrent and YouTube downloads now run through file validation before accepting into library
- Version display in sidebar now accurately reflects deployed version

## [1.0.0] - 2026-03-15

### Added
- **UI overhaul**: Visual polish, sizing improvements, quality badges (amber/lime/green/cyan)
- **DLNA casting v2**: UPnP event subscription, gapless playback, queue diff, WiiM Linkplay support
- **Multi-user**: SQLite-backed sessions, user picker, per-user recently played
- **Monorepo**: npm workspaces (`packages/server`, `packages/client`, `packages/shared`, `packages/desktop`)
- **Desktop app**: Tauri 2 scaffold for Windows + Mac
- **Release pipeline**: CI/CD, QNAP staging + production, Watchtower auto-deploy
- **DLNA casting v1**: SSDP discovery, Sonos queue, generic SetAVTransportURI, cast UI
- **Streaming**: YouTube audio proxy with HMAC-signed URLs for DLNA devices
- **Search**: MusicBrainz integration, smart Top Result, multi-artist support
- **Playback**: Gapless, crossfade, queue reorder, Top Songs
- **Mobile**: Responsive design, context menus, long-press interactions
- **Library**: VA album grouping, recently played, deduplication, album/track deletion

### Infrastructure
- Docker multi-stage builds (dev + prod)
- Docker Compose with base + dev + prod overlays
- Health endpoint with version and API compatibility checking
- Server-side session storage, search history
- HMAC stream authentication for external devices
