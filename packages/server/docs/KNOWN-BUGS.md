# Known Bugs

Open bugs organized by area. Each entry has enough context to start implementation in a new session.

---

## Setup Wizard UX (11 items)

### BUG-SW-001: Sections auto-collapse after save
- **Expected:** Section stays open after save so user can test connection
- **Actual:** `handleConfigured(id)` calls `setExpanded(null)` immediately after save
- **File:** `packages/client/src/components/SetupWizard.jsx:576-578`
- **Fix:** Remove `setExpanded(null)` from `handleConfigured`. Let user manually collapse or have it collapse when they expand a different section.

### BUG-SW-002: Form fields don't persist on reopen
- **Expected:** Reopening a configured service shows saved values (username visible, password masked, tokens visible)
- **Actual:** All forms initialize with empty `useState('')` - no `useEffect` loads saved config
- **Affected forms:** LastfmForm (line 252), RdForm (line 346), VpnForm (line 409), SlskForm (line 477)
- **File:** `packages/client/src/components/SetupWizard.jsx`
- **Fix:** Add `useEffect` to each form that calls the status API and pre-populates fields. Follow the pattern from `SettingsModal.jsx` lines 61-65 (Soulseek) and 177-183 (VPN).

### BUG-SW-003: Last.fm fields greyed out after connecting
- **Expected:** After connecting Last.fm, API key and secret fields should be viewable (read-only) or re-editable
- **Actual:** Fields become disabled/greyed with no way to view or update credentials
- **File:** `packages/client/src/components/SetupWizard.jsx` - LastfmForm

### BUG-SW-004: VPN password should show masked, not empty
- **Expected:** Password field shows masked chars when credentials are saved
- **Actual:** Password field is empty on reopen - user cannot tell if password is saved
- **File:** `packages/client/src/components/SetupWizard.jsx:411`

### BUG-SW-005: VPN region doesn't persist
- **Expected:** Region dropdown shows the saved region (e.g., "US Las Vegas")
- **Actual:** Defaults to "US East" on reopen
- **File:** `packages/client/src/components/SetupWizard.jsx:412`

### BUG-SW-006: VPN Test Connection does nothing
- **Expected:** Shows success/failure feedback
- **Actual:** No visible response - Gluetun container may be crashed
- **File:** `packages/client/src/components/SetupWizard.jsx` - VpnForm handleTest

### BUG-SW-007: API keys/tokens should show in clear text, only passwords masked
- **Expected:** Last.fm API key, RD token visible. Only passwords (VPN, Soulseek) masked.
- **Actual:** Inconsistent masking
- **File:** `packages/client/src/components/SetupWizard.jsx` - all forms

### BUG-SW-008: Soulseek shows unconfigured despite working connection
- **Expected:** Green dot when slskd is connected to Soulseek network
- **Actual:** Grey dot because DB has no soulseekConfig entry (creds set via CLI/env)
- **File:** `packages/server/src/api/setup.js:152-154`
- **Fix:** Check live slskd status in addition to DB config.

### BUG-SW-009: Soulseek auto-generated credentials not explained
- **Expected:** Text explaining random account was created during setup
- **Actual:** Empty fields with no context
- **File:** `packages/client/src/components/SetupWizard.jsx` - SlskForm

### BUG-SW-010: Summary page shows Soulseek "Not configured"
- **Expected:** Green if slskd is connected (regardless of config source)
- **Actual:** Checks DB only (same root cause as BUG-SW-008)
- **File:** `packages/server/src/api/setup.js:152-154`

### BUG-SW-011: Soulseek in Settings should show saved username + masked password
- **Expected:** Pre-filled username, masked password
- **Actual:** Empty fields
- **File:** `packages/client/src/components/SettingsModal.jsx:60-65`

---

## Search Quality (Parked)

### BUG-010: Search ranking returns obscure albums
- **Status:** Parked for dedicated search deep dive initiative

---

## Infrastructure

### BUG-007 (partial): Gluetun container management
- v1.7.4 bootstrap collects VPN creds. But if user skips, Gluetun still starts and crashes.
- Consider Docker Compose profiles to skip starting Gluetun when creds are empty.

---

## Architecture Notes (from Navidrome/Jellyfin research)

### Future: Navidrome-style Persistent IDs (PIDs)
- Generate track IDs from `(artist, album, title, disc, track_number)` hash
- Survive file moves, re-downloads, format upgrades

### Future: Jellyfin-style BlurHash for cover art
- Generate 20-30 char BlurHash per album for instant placeholder rendering

### Future: Subsonic API compatibility
- Would enable existing mobile clients (DSub, Symfonium, etc.)
