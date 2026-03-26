# Known Bugs

> **Last updated:** 2026-03-25 (v1.7.1)

Tracked issues grouped by impact area. Fixed issues are marked with version.

## Critical — First-Time Setup

### BUG-001: Session state persists across clean reinstall (HIGH)
- **Expected:** Clean install produces empty UI with no prior session data
- **Actual:** Stale album view (Pink Floyd Animals), queue (Heilung Futha), and search history appear after deleting all config/music dirs and running bootstrap fresh
- **Root cause:** Client's `beforeunload` handler writes React state to `PUT /api/session` before page unloads. The new server accepts it unconditionally and stores it in the fresh DB. On next load, the client fetches the stale state from the new server.
- **Fix needed:** (1) Client: don't write session state when server returns `setup_required`. (2) Server: reject `PUT /api/session` before setup is complete. (3) Add `DELETE /api/session` endpoint.
- **Environment:** QNAP staging, v1.6.8 → v1.7.0 clean reinstall via bootstrap.sh
- **Workaround:** Manually `rm config/notify.db*` after bootstrap, restart container

### BUG-007: Gluetun VPN crashes on fresh install (LOW)
- **Expected:** VPN container either doesn't start until configured, or waits gracefully
- **Actual:** Gluetun starts and immediately exits: `ERROR VPN settings: OpenVPN settings: user is empty`
- **Root cause:** Bootstrap asks "Enable VPN?" but doesn't collect credentials. Gluetun starts with empty config.
- **Environment:** QNAP staging, bootstrap.sh fresh install
- **Fix options:** (a) Don't start Gluetun until VPN configured in Settings. (b) Start with health check that accepts "unconfigured" as valid state.

### BUG-012: Soulseek 401 after bootstrap — API key mismatch (LOW)
- **Expected:** Not-ify communicates with slskd seamlessly after bootstrap
- **Actual:** `POST /api/soulseek/test` returns `{"status":"error","error":"slskd returned HTTP 401"}`
- **Root cause:** Bootstrap generates `SLSKD_API_KEY` and passes to both containers. After `docker rm -f` + `docker compose up -d`, the `.env` key and slskd config file (`slskd/slskd.yml`) may fall out of sync.
- **Environment:** QNAP staging, v1.7.0, after container rebuild
- **Workaround:** Verify `SLSKD_API_KEY` in `.env` matches `api_key` in `slskd/slskd.yml`

### BUG-013: RD "fetch failed" — unclear error when VPN is down (LOW)
- **Expected:** Test connection shows "VPN not configured — Real-Debrid requires VPN proxy"
- **Actual:** Shows generic "fetch failed"
- **Root cause:** `getProxyFetch()` routes RD traffic through Gluetun HTTP proxy. When Gluetun is down, fetch throws with no context.
- **Environment:** QNAP staging, v1.7.0, Gluetun unconfigured

---

## Playback

### BUG-011: Intermittent pause delay (2-4 seconds) (MEDIUM)
- **Expected:** Audio stops immediately on pause click
- **Actual:** Audio continues for 2-4 seconds after clicking pause, then stops. Not every time — intermittent.
- **Root cause:** Under investigation. Possible causes: (a) Audio buffer has pre-loaded data that continues playing. (b) `audioRef.current.pause()` races with a state update that restarts playback. (c) Network latency on stream response keeps feeding the audio element.
- **Environment:** QNAP staging, v1.7.1, Chrome browser, library MP3 streams

---

## UI (Open)

### Scrobble sync UX issues (Last.fm)
Three issues with the scrobble sync in Settings:
1. **Retry button doesn't work** — after a sync failure (e.g., Last.fm API 500), clicking retry does nothing
2. **No progress indication on retry** — when retry does trigger, there's no visual feedback that it's working
3. **No completion count** — after sync finishes, doesn't show how many scrobbles were synced (e.g., "Synced 107,224 scrobbles")

### Duplicate track highlighting
When an album has multiple tracks with the same title (e.g., Tool Undertow has "Prison Sex" listed 3 times), all matching tracks highlight when one is playing. The highlight matches by title, not by unique track ID/position. A fix was attempted and reverted (broke highlighting entirely) — needs a more careful approach that preserves YT preview highlighting while deduplicating same-title tracks.

### Multi-disc albums show inconsistent tracklists
Albums with multiple media/discs on MusicBrainz (e.g., Bonobo "Black Sands Remixed") show different tracklists on each click. Track numbering restarts at 1 for each disc, mixing with library tracks. The MB release selection is non-deterministic across clicks, and multi-disc releases aren't handled (tracks from all discs are flattened into one list).

## Pipeline

### Soulseek track titles show full peer filenames
When Soulseek downloads complete, track titles in the library show the raw peer filename (e.g., `virte, adèle. close to the water (w wajdi riahi...) [2024]. 01. close to the water`) instead of cleaned-up track names. The filenames from Soulseek peers often include artist, album, year, and encoding info. Need to strip this metadata from filenames when importing from Soulseek.

## Infrastructure

### slskd setup requires manual SSH + YAML config
Setting up Soulseek on a new deployment requires:
1. SSH into host, write `slskd.yml` with Soulseek credentials + API key
2. Set `SLSKD_API_KEY` env var on the not-ify container
3. Restart both containers

This should be automated: when the user enters Soulseek credentials in the Settings UI, not-ify should configure slskd automatically — either via the slskd API (if it supports credential updates) or by writing the config file to a shared volume and restarting slskd. The API key should be auto-generated and shared between containers without manual env var setup.

### Docker restart after library path change kills dev server
`process.exit(0)` in the library path change handler works in Docker (restart policy) but kills the dev server permanently. In dev mode, the UI shows "Restarting server..." forever. Need either: (a) don't restart in dev, just re-read the config, or (b) detect non-Docker and warn the user to restart manually.

### slskd auto-generated creds rejected by Soulseek network
Setup script generates random Soulseek username/password for slskd, but slskd validates them against the Soulseek network on startup and rejects them (`username and/or password invalid`). **Fix**: Start slskd without network credentials (API-only mode) — just configure the API key for not-ify communication. Mark Soulseek as "not connected" in the web UI. User enters their real Soulseek creds in Settings when ready.

### Gluetun fails on first start — no VPN credentials
Bootstrap script asks "Enable VPN?" but doesn't collect VPN provider credentials. Gluetun starts and immediately exits with `user is empty`. **Fix options**: (a) Prompt for VPN creds during CLI setup if user enables VPN. (b) Don't start gluetun container until creds are configured in the web UI — start it on-demand after Settings saves VPN config. (c) Start gluetun but expect it to fail, let Settings UI restart it after creds are entered.

### docker compose commands fail without --env-file flag
Running bare `docker compose` in the install directory fails with "variable not set" warnings because compose doesn't auto-read `.env` on all platforms. The setup script now writes a single `.env` file, but existing installs from before the fix have split `.env` + `.env.local` files. **Workaround**: Always use `docker compose --env-file .env`. **Fix**: Ensure compose template uses `env_file:` directive or document the requirement clearly.

### Config dir default may be overridden by folder browser
During setup, config dir landed on CACHEDEV3 (`/share/CACHEDEV3_DATA/Media/container-station-data/not-ify`) instead of the expected CACHEDEV1 default. May be caused by the folder browser navigation overriding the default path. Needs investigation — the default should stick unless user explicitly navigates away.

## Playback

### Playback stalls between tracks
Files show as downloaded in the library but playback stalls for several minutes when advancing to the next track. Tracks eventually play but the delay is unacceptable. Possible causes:
- Library scanner hasn't indexed the new file when player requests it
- Node event loop blocked during ffmpeg conversion or file validation
- Stream endpoint blocked by ongoing download processing
- Client audio element not pre-loading next track

### Files downloaded but not playable (404 on stream)
Files appear on disk in the correct folder and the library API returns them, but clicking play returns 404. The library scanner may have a stale cache, or the track ID hash doesn't match the file on disk after an upgrade replaced it.

### .webm files not converted to MP3
Some yt-dlp downloads produce `.webm` files instead of `.mp3`. The post-processing pipeline should convert to MP3 but occasionally fails silently, leaving an unplayable `.webm` in the library.

## Setup Script

### QNAP SSH access for non-admin users
QNAP SSHD rejects key-based and password-based auth for non-admin users despite correct `AllowUsers`, home dir permissions, and authorized_keys setup. May be a QNAP firmware restriction. Workaround: use admin account or HTTP API for monitoring.

### No client-side telemetry for debugging
Cannot observe UI events (play, pause, skip, navigation clicks, errors) from the server side. Playback stalls and navigation issues are invisible without browser console access. Need lightweight client → server telemetry endpoint that captures UI events with timing and correlates them with server-side processing.
