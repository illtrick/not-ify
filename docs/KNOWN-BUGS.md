# Known Bugs — Not-ify

Last updated: 2026-03-27 (v1.7.13 — all bugs closed)

## Status Key
- **OPEN** — not fixed, needs implementation
- **VERIFIED** — fix shipped but needs staging verification
- **CLOSED** — fix verified on staging
- **PARKED** — deferred to a future initiative

---

## Group 1: Player Reliability (CRITICAL)

### BUG-P01: Track click doesn't play immediately — waits for download queue
- **Severity:** CRITICAL
- **Reported:** v1.7.10 staging
- **Repro:** Open compilation album, click track 3, wait for play, click track 8. Track 8 doesn't play — system downloads tracks 4-7 sequentially first.
- **Expected:** Click track 8 → immediate YT stream playback. Downloads happen in background.
- **Root cause:** `ytQueueAlbum()` queues all tracks sequentially. No priority mechanism for the user's selected track. The player waits for the YT queue to reach the selected track.
- **Fix needed:** (1) When user clicks a track, prioritize that track in the YT queue (move to front). (2) Start YT streaming immediately via `/api/yt/stream` while download happens in background. (3) Decouple playback intent from download queue.
- **Files:** `packages/server/src/api/youtube.js` (queue priority), `packages/client/src/hooks/usePlayer.js` (immediate stream)

### BUG-P02: Rapid auto-skip when clicking certain tracks
- **Severity:** HIGH
- **Reported:** v1.7.10 staging (Tool - Lateralus)
- **Repro:** Click track on album. It rapidly skips through multiple tracks, landing on a later track.
- **Expected:** Clicking track N plays track N.
- **Root cause:** `onError` handler auto-advances on load failure. If the stream URL for the clicked track fails (wrong path, file not found), it fires `onError` → `playNext()` → next track also fails → cascade. The `09-Lateralus.webm` leftover causes a path mismatch for track 9.
- **Fix needed:** (1) Remove auto-advance on error — show error state instead. (2) Let user decide to skip or retry. (3) Clean up `.webm` leftovers from yt-dlp.
- **Files:** `packages/client/src/hooks/usePlayer.js` (onError handler), `packages/server/src/api/youtube.js` (webm cleanup)

### BUG-P03: Track selection latency — ms to seconds for downloaded tracks
- **Severity:** HIGH
- **Reported:** v1.7.10 staging
- **Repro:** Click a track that has MP3 badge (fully downloaded). Playback doesn't start for 1-4 seconds.
- **Expected:** Downloaded tracks should play within ~100ms (local file stream, no network dependency).
- **Root cause:** (1) Library-first lookup scans full array on each click. (2) No audio preloading — cold start on every track. (3) Stream URL construction goes through multiple fallbacks.
- **Fix needed:** (1) Pre-build track→filepath Map on library load (O(1) lookup). (2) Preload next track's audio via `new Audio()`. (3) Direct filepath for library tracks, skip the `/api/stream/:id` redirect.
- **Files:** `packages/client/src/hooks/usePlayer.js`, `packages/server/src/api/library.js`

### BUG-P04: Rapid skip (4 clicks = 1-2 advances instead of 4)
- **Severity:** MEDIUM
- **Reported:** v1.7.8 staging, partially fixed v1.7.9, still present v1.7.10
- **Repro:** Click next button 4 times quickly.
- **Expected:** 4 track advances.
- **Root cause:** `pendingIdxRef` clear timing — clearing on `playTrack()` audio src set is better than `setTimeout(0)` but still races with React state updates.
- **Fix needed:** Serial queue for skip operations. Buffer clicks and process sequentially.
- **Files:** `packages/client/src/hooks/usePlayer.js`

### BUG-P05: Now-playing bar missing album art
- **Severity:** LOW
- **Reported:** v1.7.10 staging (Tool - Lateralus, track "Eon Blue Apocalypse")
- **Repro:** Play track → now-playing bar shows music note instead of album cover.
- **Expected:** Album cover art displayed in now-playing bar.
- **Root cause:** `coverArt` not passed to `setCurrentCoverArt()` when track is played from library view. The track object from the new schema doesn't carry `coverArt` — it's on the album object, not the track.
- **Fix needed:** Pass `albumInfo.coverArt` to player when starting playback from album view.
- **Files:** `packages/client/src/components/AlbumView.jsx`, `packages/client/src/hooks/usePlayer.js`

---

## Group 2: Badge System

### BUG-B01: MP3 badges don't update to FLAC after upgrade completes
- **Severity:** HIGH
- **Reported:** v1.7.10 staging (Tool - Lateralus)
- **Repro:** All tracks show MP3. Activity log shows all 13 upgraded to FLAC. Badges remain MP3.
- **Expected:** Badges transition MP3 → FLAC when upgrade completes.
- **Root cause:** `track_files` table may not be updated after `replaceTracksIfBetter()`. The directory scan in `processDownload()` writes `track_files` but the `upsertTrackFile` might not be matching the correct `album_track` by title. Also, SSE library refresh may not trigger after upgrade events.
- **Fix needed:** (1) Verify `track_files.format` is updated after file replacement. (2) Ensure SSE upgrade event triggers client library refresh. (3) Force refresh badges on album view re-render.
- **Files:** `packages/server/src/services/job-processor.js`, `packages/client/src/hooks/useLibrary.js`

### BUG-B02: Processing dots don't clear after download completes
- **Severity:** HIGH
- **Reported:** v1.7.10 staging
- **Repro:** Track shows processing dot. Download completes ("Saved: X"). Processing dot remains instead of transitioning to MP3.
- **Expected:** Processing → MP3 within seconds of download completing.
- **Root cause:** Library API derives `fileStatus` from job queue state. After YT download completes, the YT queue entry changes to `status: 'done'` but the library API might still see it as active if the query runs before the status update propagates. Also, client-side debounce (3s) means refresh doesn't happen immediately.
- **Fix needed:** (1) Reduce SSE debounce for "Saved:" events (or make it immediate). (2) Ensure `getQueueStatus()` only returns truly active/queued entries.
- **Files:** `packages/server/src/api/youtube.js` (getQueueStatus), `packages/client/src/App.jsx` (SSE debounce)

### BUG-B03: Track with same name as album shows untouched badge
- **Severity:** MEDIUM
- **Reported:** v1.7.10 staging (Tool - Lateralus, track 9 "Lateralus")
- **Repro:** Track 9 "Lateralus" shows `—` despite file `09-Lateralus.mp3` existing on disk.
- **Expected:** MP3 badge.
- **Root cause:** Title normalization collision — `normalize("Lateralus")` matches both the album name and the track title. The `track_files` matching might be confused by the `.webm` leftover (`09-Lateralus.webm`).
- **Fix needed:** (1) Match by track number first (from filename prefix), title as fallback. (2) Clean up `.webm` files after yt-dlp conversion.
- **Files:** `packages/server/src/services/job-processor.js` (matching), `packages/server/src/api/youtube.js` (webm cleanup)

### BUG-B04: Now-playing track loses its format badge
- **Severity:** LOW
- **Reported:** v1.7.10 staging
- **Repro:** Track 9 playing, shows processing dot instead of MP3 badge.
- **Expected:** Playing track retains its format badge.
- **Root cause:** The now-playing indicator replaces the badge column content. Should coexist — show both the play animation AND the format badge.
- **Files:** `packages/client/src/components/AlbumView.jsx`

---

## Group 3: Album/Library Data Integrity

### BUG-L01: Compilation album fragmented into multiple entries
- **Severity:** HIGH
- **Reported:** v1.7.10 staging (Tool - "Loving the Alien")
- **Repro:** Open compilation album with 3+ artists. Library shows two entries: "Tool" and "Various Artists" for the same album.
- **Expected:** Single entry with `album_artist = "Various Artists"`.
- **Root cause:** Album created in `albums` table when first viewed from search with `album_artist = "Tool"` (from MB release artist-credit). Later, migration or re-sync detects 3+ unique track artists and creates a second entry with "Various Artists". Two album IDs for the same album.
- **Fix needed:** (1) Use MB release artist-credit correctly — compilation releases have "Various Artists" as artist-credit. (2) Dedup albums by `rgid` before inserting. (3) Never create duplicate albums for the same `rgid`.
- **Files:** `packages/server/src/api/search.js`, `packages/server/src/services/db.js`

### BUG-L02: Album view shows no tracks
- **Severity:** HIGH
- **Reported:** v1.7.10 staging ("Loving the Alien")
- **Repro:** Navigate to album → header shows but track list is empty.
- **Expected:** All 16 tracks listed.
- **Root cause:** `album_tracks` rows linked to one album ID, but UI loads via the other album ID (due to BUG-L01 fragmentation). `getAlbumTracks(albumId)` returns empty for the wrong ID.
- **Fix needed:** Fix BUG-L01 (single album entry). Also add fallback: if no `album_tracks` found, look up by `rgid` or `artist+title`.
- **Files:** `packages/server/src/api/library.js`, `packages/server/src/services/db.js`

### BUG-L03: Different cover art for same album across UI locations
- **Severity:** MEDIUM
- **Reported:** v1.7.10 staging ("Loving the Alien")
- **Repro:** Recently played shows David Bowie cover, album header shows Tool cover, library sidebar shows both.
- **Expected:** Consistent cover art everywhere.
- **Root cause:** Cover art lookup by `artist + album` matches wrong release when album title is shared across artists ("Loving the Alien" by both Bowie and Tool). The `rgid`-based lookup should be used instead.
- **Fix needed:** Always use `rgid` for cover art lookup when available. Fall back to `artist + album` only when no `rgid`.
- **Files:** `packages/server/src/api/cover.js`, `packages/client/src/components/AlbumView.jsx`

### BUG-L04: Ghost "Recently Played" entry with no name
- **Severity:** LOW
- **Reported:** v1.7.10 staging
- **Repro:** Top recently played entry shows "Album · Tool" with music note icon, no album name.
- **Expected:** No ghost entries in recently played.
- **Root cause:** An empty or partial `addToRecentlyPlayed()` call created an entry with missing fields.
- **Fix needed:** Validate recently played entries before saving — require non-empty artist + album.
- **Files:** `packages/client/src/hooks/useRecentlyPlayed.js`

### BUG-L05: Duration inconsistent (114 min → 79 min on refresh)
- **Severity:** LOW
- **Reported:** v1.7.10 staging (Tool - Lateralus)
- **Repro:** Album initially shows 114 min, after library refresh corrects to 79 min.
- **Expected:** Constant duration from MB metadata.
- **Root cause:** First render uses stale/calculated duration. After library refresh, uses the `albums.duration` from DB.
- **Fix needed:** Always read duration from `albums.duration`. Never calculate from track files.
- **Files:** `packages/client/src/components/AlbumView.jsx`

---

## Group 4: Download Pipeline

### BUG-D01: `.webm` leftover files from yt-dlp
- **Severity:** MEDIUM
- **Reported:** v1.7.10 staging
- **Repro:** After YT download completes, `.webm` intermediate files remain alongside `.mp3`.
- **Expected:** Only final `.mp3` file remains.
- **Root cause:** `yt-dlp` downloads as `.webm`, converts to `.mp3`, but doesn't always delete the intermediate.
- **Fix needed:** After download completes, delete any `.webm`/`.opus`/`.m4a` intermediate files with the same base name.
- **Files:** `packages/server/src/api/youtube.js`

### BUG-D02: Duplicate files (numbered + unnumbered) for same track
- **Severity:** MEDIUM
- **Reported:** v1.7.10 staging ("Loving the Alien")
- **Repro:** Click single track → downloads as `Comfortably Numb.mp3`. Album queue also downloads as `08-Comfortably Numb.mp3`.
- **Expected:** Single file per track.
- **Root cause:** Single-track YT stream creates unnumbered file. Album queue creates numbered file. Skip-existing check only matches by track number prefix.
- **Fix needed:** Skip-existing should also match by normalized title without number prefix.
- **Files:** `packages/server/src/api/youtube.js`

### BUG-D03: `.metadata.json` mbTracks not sorted by position
- **Severity:** MEDIUM
- **Reported:** v1.7.10 staging ("Loving the Alien")
- **Repro:** Click track 3, album download starts. `.metadata.json` has tracks in order 6-16, 1-5.
- **Expected:** `mbTracks` sorted by position 1-16.
- **Root cause:** `ytQueueAlbum()` writes mbTracks from the tracks array without sorting.
- **Fix needed:** Sort `mbTracks` by position before writing to `.metadata.json`.
- **Files:** `packages/server/src/api/youtube.js`

### BUG-D04: Missing tracks in download
- **Severity:** HIGH
- **Reported:** v1.7.10 staging ("Loving the Alien" — tracks 1-2 never downloaded)
- **Repro:** Click track 3, download starts. Tracks 1-2 never appear on disk.
- **Expected:** All album tracks downloaded.
- **Root cause:** YT queue starts from clicked track, wraps around, but early tracks may fail silently.
- **Fix needed:** Ensure all tracks are queued and verify completion. Log and retry failed tracks.
- **Files:** `packages/server/src/api/youtube.js`

### BUG-D05: `year: null` not populated from MusicBrainz
- **Severity:** LOW
- **Reported:** v1.7.10 staging
- **Repro:** `.metadata.json` has `year: null`.
- **Expected:** Year extracted from MB release date.
- **Root cause:** `ytQueueAlbum()` accepts `year` param but client doesn't always pass it.
- **Fix needed:** Extract year from MB release date. Pass year from client.
- **Files:** `packages/server/src/api/youtube.js`, `packages/client/src/components/AlbumView.jsx`

---

## Group 5: Setup Wizard / Settings

### BUG-S01: CLI invalid input falls through to defaults
- **Severity:** MEDIUM
- **Reported:** v1.7.10 staging
- **Repro:** Type username at VPN provider select → wizard skips VPN setup.
- **Expected:** "Invalid selection, try again" → re-prompt.
- **Root cause:** No input validation loop in `read` prompts.
- **Fix needed:** Wrap all `select` and `Y/n` prompts in retry loops.
- **Files:** `scripts/bootstrap.sh`

### BUG-S02: Soulseek shows unconfigured on fresh install
- **Severity:** MEDIUM
- **Reported:** v1.7.8, v1.7.10 staging (still not fixed)
- **Repro:** Fresh install → setup wizard → Soulseek shows grey dot.
- **Expected:** Green dot, pre-filled username, masked password, explanatory text.
- **Root cause:** CLI bootstrap configures slskd via `slskd.yml`, not through app DB. Wizard only checks DB.
- **Fix needed:** (1) Save Soulseek credentials to app DB during bootstrap. (2) Wizard checks live slskd API.
- **Files:** `scripts/setup.sh`, `packages/server/src/api/setup.js`, `packages/client/src/components/SetupWizard.jsx`

### BUG-S03: VPN needs container restart after UI credential save
- **Severity:** LOW
- **Reported:** v1.7.10 staging
- **Repro:** Save VPN credentials in UI → test → "partially connected". Need manual `docker compose restart gluetun`.
- **Expected:** Saving VPN credentials restarts Gluetun automatically.
- **Root cause:** VPN save writes `.env` but doesn't restart container.
- **Fix needed:** Trigger container restart after VPN config save.
- **Files:** `packages/server/src/api/setup.js`

---

## Group 6: Parked (Future Initiatives)

### BUG-X01: Search ranking returns obscure albums over popular ones
- **Status:** PARKED for search deep dive initiative

### BUG-X02: Popular Tracks missing from artist page
- **Status:** PARKED for artist page redesign

---

## Fix Priority Order

1. **Group 1 (Player):** P01, P02, P03, P04, P05 — core UX, most user-visible
2. **Group 3 (Album/Library):** L01, L02, L03 — data integrity, blocks correct playback
3. **Group 2 (Badges):** B01, B02, B03, B04 — visual feedback, depends on Group 3 fixes
4. **Group 4 (Download):** D01, D02, D03, D04, D05 — pipeline reliability
5. **Group 5 (Setup):** S01, S02, S03 — first-run UX
