# Known Bugs — v1.7.4

Open bugs organized by area. Each entry has enough context to start implementation in a new session.

**Last updated:** 2026-03-26
**Current version:** 1.7.4

---

## Fixed in v1.7.0–v1.7.4 (verified or needs staging retest)

| ID | Description | Version | Staging Status |
|----|-------------|---------|----------------|
| BUG-001 | Session state persists across clean reinstall | v1.7.3 + v1.7.4 | **Needs retest** — v1.7.3 fix failed, v1.7.4 added localStorage.clear() |
| BUG-002 | YT stream used even when track in library | v1.7.0 | Verified |
| BUG-003 | ClamAV blocks streaming on initial downloads | v1.7.0 | Verified |
| BUG-005 | Recently played opens search instead of album | v1.7.0 | Verified |
| BUG-006 | Previous button never goes to previous track | v1.7.0 | Verified |
| BUG-007 | Gluetun VPN status message | v1.7.3 | Partial — bootstrap now collects creds |
| BUG-008 | Now-playing indicator leaks across albums | v1.7.1 | Verified |
| BUG-009 | Year missing from library album header | v1.7.1 | Verified |
| BUG-011 | Intermittent pause delay (2-4s) | v1.7.2 | **Needs retest** |
| BUG-012 | Soulseek 401 — API key out of sync | v1.7.3 | Verified |
| BUG-013 | RD "fetch failed" — vague VPN error | v1.7.3 + v1.7.4 | **Needs retest** — v1.7.3 had regression, v1.7.4 fixed |
| BUG-014 | Playback controls broken on first-search album | v1.7.2 + v1.7.4 | **Needs retest** — v1.7.2 partial, v1.7.4 ref-based refactor |
| BUG-017 | Cover art 60s load delay | v1.7.4 | **Needs retest** — server-side pre-warm added |
| BUG-018 | MP3 badges don't appear during download | v1.7.4 | **Needs retest** — ref-based playlist + updatePlaylist |
| BUG-019 | Advance track dual-highlight + 4s delay | v1.7.4 | **Needs retest** |
| BUG-020 | Track controls become non-functional | v1.7.4 | **Needs retest** |
| BUG-022 | Cross-album track bleed | v1.7.4 | **Needs retest** — exact album matching |
| Track ordering | All track_number NULL from YT downloads | v1.7.4 | **Needs retest** — MB metadata now source of truth |
| Unicode normalize | ß and ı matching failures | v1.7.4 | **Needs retest** — toUpperCase().toLowerCase() fix |

---

## Open: Setup Wizard UX (11 items)

### BUG-SW-001: Sections auto-collapse after save
- **Expected:** Section stays open after save so user can test connection
- **Actual:** `handleConfigured(id)` calls `setExpanded(null)` immediately after save
- **File:** `packages/client/src/components/SetupWizard.jsx:576-578`
- **Fix:** Remove `setExpanded(null)` from `handleConfigured`. Let user manually collapse or have it collapse when they expand a different section.

### BUG-SW-002: Form fields don't persist on reopen
- **Expected:** Reopening a configured service shows saved values (username visible, password masked, tokens visible)
- **Actual:** All forms initialize with empty `useState('')` — no `useEffect` loads saved config
- **Affected forms:** LastfmForm (line 252), RdForm (line 346), VpnForm (line 409), SlskForm (line 477)
- **File:** `packages/client/src/components/SetupWizard.jsx`
- **Fix:** Add `useEffect` to each form that calls the status API and pre-populates fields. Follow the pattern from `SettingsModal.jsx` lines 61-65 (Soulseek) and 177-183 (VPN).

### BUG-SW-003: Last.fm fields greyed out after connecting
- **Expected:** After connecting Last.fm, API key and secret fields should be viewable (read-only) or re-editable
- **Actual:** Fields become disabled/greyed with no way to view or update credentials
- **File:** `packages/client/src/components/SetupWizard.jsx` — LastfmForm

### BUG-SW-004: VPN password should show masked, not empty
- **Expected:** Password field shows `••••••••` when credentials are saved
- **Actual:** Password field is empty on reopen — user can't tell if password is saved
- **File:** `packages/client/src/components/SetupWizard.jsx:411`

### BUG-SW-005: VPN region doesn't persist
- **Expected:** Region dropdown shows the saved region (e.g., "US Las Vegas")
- **Actual:** Defaults to "US East" on reopen
- **File:** `packages/client/src/components/SetupWizard.jsx:412`
- **Note:** SettingsModal handles this correctly at line 180

### BUG-SW-006: VPN Test Connection does nothing
- **Expected:** Shows success/failure feedback
- **Actual:** No visible response — likely Gluetun container is crashed (no creds from bootstrap)
- **File:** `packages/client/src/components/SetupWizard.jsx` — VpnForm handleTest
- **Root cause:** Gluetun may not be running. The test should show "Gluetun not running" if the container is down.

### BUG-SW-007: API keys/tokens should show in clear text, only passwords masked
- **Expected:** Last.fm API key, RD token visible. Only passwords (VPN, Soulseek) masked.
- **Actual:** Inconsistent masking — some fields use `type="password"` for tokens
- **File:** `packages/client/src/components/SetupWizard.jsx` — all forms

### BUG-SW-008: Soulseek shows unconfigured despite working connection
- **Expected:** Green dot when slskd is connected to Soulseek network
- **Actual:** Grey dot because DB has no `soulseekConfig` entry (creds set via CLI/env)
- **File:** `packages/server/src/api/setup.js:152-154`
- **Fix:** `/api/setup/services` should check live slskd status (`GET /api/soulseek/status`) in addition to DB config. If `connected: true`, report as configured.

### BUG-SW-009: Soulseek auto-generated credentials not explained
- **Expected:** Text like "A random Soulseek account was created during setup. Change only if you want to use your own."
- **Actual:** Empty fields with no context about the auto-generated account
- **File:** `packages/client/src/components/SetupWizard.jsx` — SlskForm

### BUG-SW-010: Summary page shows Soulseek "Not configured"
- **Expected:** Green if slskd is connected (regardless of how it was configured)
- **Actual:** Checks DB only (same root cause as BUG-SW-008)
- **File:** `packages/server/src/api/setup.js:152-154`, `SetupWizard.jsx:694`

### BUG-SW-011: Soulseek in Settings should show saved username + masked password
- **Expected:** Pre-filled username, masked password from `slskConfig.status`
- **Actual:** Empty fields
- **File:** `packages/client/src/components/SettingsModal.jsx:60-65`

---

## Open: Search Quality (Parked)

### BUG-010: Search ranking returns obscure albums
- **Status:** Parked for dedicated search deep dive initiative

---

## Open: Infrastructure

### BUG-007 (partial): Gluetun container management
- v1.7.4 bootstrap collects VPN creds. But if user skips, Gluetun still starts and crashes.
- Consider Docker Compose profiles to skip starting Gluetun when creds are empty.
- **File:** `scripts/docker-compose.template.yml` — gluetun service

---

## Architecture Notes (from Navidrome/Jellyfin/Plex/Funkwhale research)

### Completed: Ref-based player (v1.7.4)
- Playlist and index stored in refs, not React state — eliminates stale closures
- Pattern follows Navidrome (Redux store), Jellyfin (singleton manager)

### Completed: Exact album matching (v1.7.4)
- Removed fuzzy `startsWith` — follows Navidrome's tag-based identity (zero fuzzy matching)

### Completed: MB metadata as source of truth (v1.7.4)
- Track titles, positions from MusicBrainz stored in `.metadata.json`
- `syncAlbum` uses MB data over filename-derived data

### Completed: Unicode-safe normalize (v1.7.4)
- `toUpperCase().toLowerCase()` handles ß→ss, ı→i
- Validated against 2000 tracks from 33K unique Spotify entries

### Future: Jellyfin-style BlurHash for cover art
- Generate 20-30 char BlurHash per album for instant placeholder rendering
- Current: server-side pre-warm reduces delay but still requires HTTP round-trips

### Future: Subsonic API compatibility
- Would enable existing mobile clients (DSub, Symfonium, etc.)
- Key endpoints: `getAlbumList2`, `stream`, `getCoverArt`, `search3`
- Requires stable PIDs (partially done — track IDs are now content-hash based)

### Future: Server-side play queue (Plex pattern)
- Queue owned by server, client is thin renderer
- Enables cross-device playback continuity
- Current: client-owned queue with server session persistence
