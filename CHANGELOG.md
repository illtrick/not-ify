# Changelog

All notable changes to Not-ify are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/). Versioning follows [Semantic Versioning](https://semver.org/).

- **MAJOR** (x.0.0): Breaking changes to API, data formats, or deployment
- **MINOR** (0.x.0): New features, meaningful improvements
- **PATCH** (0.0.x): Bug fixes, polish, iteration on current features

## [1.7.4] - 2026-03-26

### Changed
- **Player architecture refactor**: Playlist and index now stored in refs instead of React state, eliminating stale closures that caused controls to freeze, dual-highlight glitches, and 2-minute stream delays. Pattern follows Navidrome/Jellyfin: mutable queue read directly by playback functions, UI re-renders driven by version counter.
- **Album track matching**: Removed fuzzy `startsWith` album comparison that caused cross-album track bleed. Now uses exact album name match only (following Navidrome's tag-based identity pattern).
- **Cover art pre-warming**: Search results now trigger server-side batch fetch of cover art (6 concurrent requests) before the client renders. Eliminates the 60s grey-placeholder delay on search results.
- **Bootstrap wizard**: VPN setup now collects provider, credentials, and region during install. Replaced verbose Docker output with compact progress counter. Health checks poll every 1s (was 2s), timeout 30s (was 60s).
- **Bootstrap ASCII art**: New retro banner with piano keys.

### Fixed
- **BUG-001 v2**: Setup wizard now clears ALL localStorage on "Start Listening" click, preventing stale session data from previous installs from appearing after fresh setup.
- **BUG-013 regression**: Removed incorrect VPN proxy pre-check from RD test endpoint. RD test now tries the actual API call and provides actionable error context only when the fetch fails.
- **BUG-018/019/020**: Player controls no longer freeze when staying on an album page during downloads. AlbumView syncs its live playlist to the player via `updatePlaylist()` whenever library tracks update.
- **BUG-022**: Tracks from different albums by the same artist no longer bleed into each other's track lists.

## [1.7.3] - 2026-03-25

### Fixed
- **BUG-001: Session state persists across clean reinstall**: useSession now checks setup status before restoring or saving session data. On fresh installs, stale localStorage is cleared and server saves are blocked until setup completes.
- **BUG-007: Gluetun VPN crash without credentials**: VPN status endpoint now reports `containerRunning` state and a clear message when VPN credentials aren't configured, instead of silently crashing.
- **BUG-012: Soulseek 401 after container rebuild**: Server now checks slskd API key validity on startup. If the key is rejected (401/403), it writes the correct key to `slskd.yml` and restarts the slskd container automatically.
- **BUG-013: RD "fetch failed" — vague VPN error**: Real-Debrid test connection now pre-checks if the VPN proxy is reachable before testing. Shows "VPN proxy is not running — configure VPN in Settings" instead of generic "fetch failed".

## [1.7.2] - 2026-03-25

### Fixed
- **BUG-014: Playback controls broken on first-search album view**: Track click handlers captured stale YT preview IDs/paths via closure. AlbumView now replaces stale track objects with live library versions when tracks download, so play/pause/skip work correctly without navigating away.
- **BUG-011: Intermittent pause delay (2-4s)**: Pause now cancels any active crossfade and uses a synchronous ref to prevent `onEnded` from auto-advancing after user clicks pause. Previously, a race between the pause click and track-end event could cause the next track to start playing.

## [1.7.1] - 2026-03-25

### Changed
- **Album header cleanup**: Removed decorative color circle next to artist name
- **Upgrade button**: Now shows on all library albums (not just lossy), simplified label to "Upgrade" with hover tooltip for last attempt timestamp

### Fixed
- **Now-playing indicator (BUG-008)**: Added album context check to YT preview track matching — indicator no longer leaks to tracks on a different album
- **Year in library album header (BUG-009)**: Year now stored in SQLite `tracks` table (non-destructive migration), populated from `.metadata.json` during library sync. Client falls back to recently-played cache. Reduces online dependency on MusicBrainz for offline use.
- **Rapid next skip**: Multiple rapid next clicks now correctly advance through consecutive tracks instead of all landing on the same track (uses ref to track pending index across React render cycles)
- **Year in download metadata**: YouTube album downloads now write `year` to `.metadata.json` so it persists for offline access

## [1.7.0] - 2026-03-25

### Changed
- **Library-first streaming**: When playing a track that exists in the library, always use the library stream even if playback was initiated from a search/YT context — YouTube is now the fallback only when the track isn't downloaded yet
- **Async ClamAV for initial downloads**: File validation now defers ClamAV scanning on initial downloads so tracks become streamable immediately after ffprobe passes. ClamAV runs async after the library sync — if a file fails, it's removed and the library is re-synced. Upgrade downloads still run ClamAV synchronously before replacing existing files.

### Fixed
- **Recently played navigation**: Clicking an album in the "Recently Played" sidebar now opens the album detail view directly instead of triggering a keyword search (uses saved MBID for MusicBrainz track fetch)
- **Previous track button**: Double-pressing previous within 2 seconds now goes to the previous track instead of restarting the current track twice
- **Stale now-playing indicator**: The pink play icon on track rows no longer appears on wrong tracks from different albums — the YT preview title match now also checks artist + album
- **Library album year/duration**: Albums opened from the library sidebar now show the year and total duration in the header (extracted from track metadata)

## [1.6.0] - 2026-03-23

### Added
- **First-run setup wizard**: Fresh installs show a guided wizard — create admin account, confirm music library, optionally configure Last.fm, Real-Debrid, VPN, Soulseek
- **One-command SSH setup**: `docker run --rm -it ... setup` detects platform (QNAP/Synology/Linux), browses storage, generates docker-compose, starts containers, prints URL
- **Setup API**: `/api/setup/*` endpoints for account creation, library config, service status, setup completion
- **Setup gate middleware**: Blocks all API routes until first user is created; allows health check and setup endpoints through

### Changed
- No more hardcoded users: `nathan`, `sarah`, `default` users removed from DB seeding
- User middleware falls back to first real user instead of hardcoded `default`
- Docker image now includes bash, whiptail, jq, Docker CLI + Compose plugin for setup script

### Fixed
- Setup wizard dashboard: service status array-to-object conversion for correct display

## [1.5.2] - 2026-03-23

### Added
- **MusicBrainz search performance**: Token bucket rate limiter (burst-friendly, 5 tokens, 1/sec refill)
- **SQLite-persisted MB cache**: 6hr positive TTL, 48hr negative TTL, 24hr track TTL — survives restarts
- **Search strategy short-circuit**: Skips compound join, fuzzy, and recording search when first batch returns strong artist match (score >= 95)
- **Scrobble-based cache pre-warming**: Top 30 artists (weighted by recency) pre-cached on startup
- Recency-weighted `getTopArtists`: recent scrobbles (30 days) get 3x weight over all-time affinity

### Performance
- Well-known artist search (cold): 2.65s → 0.47s (5.6x faster)
- Artist+album search (cold): 5.09s → 0.45s (11.3x faster)
- Track search (cold): 4.89s → 0.22s (22x faster, pre-warmed)
- Cached searches: <0.25s (now persists across restarts)

## [1.5.1] - 2026-03-22

### Added
- Soulseek credentials configurable via Settings UI (pushes to slskd)
- Music library path configurable with folder browser + file migration with progress bar
- Per-track quality comparison for upgrades (replaceTracksIfBetter)
- Settings UI: Soulseek, Music Library, folder browser (admin-only sections)
- Activity log tabs simplified: all, youtube, upgrade

### Fixed
- Library path reads from DB > env > default across all services
- Server restart flow with active job handling
- Various per-track upgrade and validation fixes

## [1.4.1] - 2026-03-21

### Added
- Soulseek pipeline integration: slskd search cascade wired into upgrade flow as third source
- Soulseek download job type: enqueue → poll → copy from shared volume → validate → library
- Track deletion with soft-exclude: deleted tracks added to `.metadata.json` excluded list, upgrader respects it
- Player auto-advances on audio error (skips deleted/missing tracks)
- SSE auto-reconnect in ActivityLog (retries after 3 seconds on disconnect)

### Changed
- Download validator: MB release selection now scores by duration match, not just track count
- Download validator: partial album matches accepted (11/14 tracks = high confidence, not rejected)
- Download validator: falls back to medium confidence when MB data is unreliable (multiple release variants)
- Upgrade trigger: fires after all YT tracks are attempted (including failures), not just successes
- RD timeout/dead torrent errors now fail permanently instead of retrying 3 times
- YT downloader filters silence tracks, data tracks, and sub-5-second tracks

### Fixed
- Soulseek responses always empty: search must be stopped before fetching `/responses` sub-endpoint
- SLSKD_URL missing from `.env.dev` — native dev defaulted to Docker hostname, silently skipping Soulseek
- ActivityLog race condition: SSE events buffered during REST fetch, then merged with deduplication
- Duplicate track highlighting: matches by track ID/position instead of title (fixes "Prison Sex" x3 bug)
- Silent REST error swallowing in ActivityLog replaced with SSE fallback

## [1.4.0] - 2026-03-20

### Added
- Background job processor: wired stub into full download pipeline (magnet → RD → download → validate → replace)
- Download validator: MusicBrainz-based post-download scoring (track count + duration matching with 10s grace)
- LLM-enhanced search: Ollama query expansion generates 3-5 search variations, falls back to programmatic queries
- Torrent result ranking: token-based artist/album matching + quality detection + seeder weighting
- Discography extraction: selectAlbumFiles parses RD file paths to download only the target album
- Staging directory pattern: downloads go to _staging/ first, moved to library only after validation
- Orphaned staging cleanup on server startup (directories older than 1 hour)
- Pipeline concurrency guard: job processor checks for active manual downloads before starting

### Changed
- Job worker timeout increased from 10 to 20 minutes for large FLAC downloads
- Quality upgrader search now uses multi-query strategy instead of single query
- handleDiscographyDownload payload keys standardized to artist/album

### Fixed
- Command injection vulnerability in ffprobe file duration check (now uses execFileSync)
- Quality token matching uses word boundaries to prevent false positives (e.g. "1320MB" no longer matches "320")

## [1.3.0] - 2026-03-20

### Added
- Full internal service diagnostics: every server service exposes `getStatus()` with live operational state
- Diagnostics aggregator endpoint (`/api/diagnostics`, admin-only) collects all service state in one call
- Client-side diagnostics collector: passive API call logging, SSE connection tracking, uncaught error capture
- One-click "Copy Diagnostics" button in Status tab — produces a pasteable text blob for debugging
- Status tab now shows internal services (job-worker, job-queue, LLM, YouTube, DLNA, file-validator, RealDebrid, downloader, scrobble-sync, cast, database, upgrader) with color-coded health indicators
- `onRequest` callback hook in api-client for API call timing/latency tracking
- `window.__notifyDiagnostics` getter exposes React app state on demand for diagnostic snapshots

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
