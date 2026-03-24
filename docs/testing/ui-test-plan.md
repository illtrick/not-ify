# Not-ify UI Test Plan

> **Version:** 1.0
> **Last updated:** 2026-03-24
> **Purpose:** Repeatable end-to-end test suite for manual or assisted testing after each deploy.
> Results are logged to `test-results/` with version + timestamp for trend tracking.

---

## How to Run

**Automated (Claude-assisted):**
```bash
# From dev machine with Chrome MCP connected to staging:
# Claude runs tests via Chrome extension + API polling
# Results written to docs/testing/test-results/v{VERSION}-{TIMESTAMP}.json
```

**Manual:**
Walk through each test below, record pass/fail + timing in the results template.

---

## Metrics Collected Per Test

| Metric | Type | Description |
|--------|------|-------------|
| `pass` | boolean | Did the test succeed? |
| `latencyMs` | number | Time from action to expected result |
| `notes` | string | Observations, error messages |
| `telemetryEvents` | number | Count of telemetry events captured during test |
| `stalls` | number | Count of audio_stall events (playback tests) |
| `retries` | number | How many times user/system had to retry |

---

## Group 1: Navigation & Rendering

### 1.1 — Home page load
- **Action:** Navigate to app root URL
- **Measure:** Time from navigation to fully interactive (search bar visible, library sidebar populated)
- **Pass:** < 3s, library count visible, no console errors
- **Metrics:** `loadTimeMs`, `libraryCount`, `consoleErrors`

### 1.2 — Search results render
- **Action:** Type "radiohead" in search, press Enter
- **Measure:** Time from keypress to first result card visible
- **Pass:** < 3s, at least 1 result card with album art
- **Metrics:** `searchTimeMs`, `resultCount`, `hasAlbumArt`

### 1.3 — Album detail navigation (from search)
- **Action:** Click first search result album
- **Measure:** Time from click to track list fully rendered
- **Pass:** < 2s, track list visible with track numbers and titles, album art loaded
- **Metrics:** `navTimeMs`, `trackCount`, `hasAlbumArt`, `hasBadges`

### 1.4 — Album detail navigation (from library sidebar)
- **Action:** Click an album in "Your Library" sidebar
- **Measure:** Time from click to track list rendered
- **Pass:** < 1s (local data), tracks with format badges
- **Metrics:** `navTimeMs`, `trackCount`, `badgeCount`

### 1.5 — Recently played navigation
- **Action:** Click album in "Recently Played" section
- **Measure:** Time from click to album view
- **Pass:** < 1.5s, correct album displayed
- **Metrics:** `navTimeMs`, `correctAlbum`

### 1.6 — Back button
- **Action:** From album detail, click "Back"
- **Measure:** Time to return to previous view
- **Pass:** < 500ms, previous view restored correctly
- **Metrics:** `navTimeMs`, `correctView`

---

## Group 2: Playback — Basic

### 2.1 — Play library track (big play button)
- **Action:** Open library album, click big play button
- **Measure:** Time from click to audible sound (audio_playing event)
- **Pass:** < 2s for library track, audio element src is `/api/stream/...` (not YT)
- **Metrics:** `clickToPlayMs`, `audioSrc`, `isLibraryStream`, `volume`

### 2.2 — Play library track (click track row)
- **Action:** Click a specific track in the track list
- **Measure:** Time from click to audio_playing
- **Pass:** < 2s, correct track plays (verify title in now-playing bar)
- **Metrics:** `clickToPlayMs`, `correctTrack`, `nowPlayingTitle`

### 2.3 — Play YT preview (undownloaded track)
- **Action:** Open MB album not in library, click play
- **Measure:** Time from click to audio_playing
- **Pass:** < 10s (YT stream takes longer), shows "Downloading" in activity
- **Metrics:** `clickToPlayMs`, `isYtPreview`, `downloadStarted`

### 2.4 — Pause and resume
- **Action:** While playing, click pause. Wait 2s. Click play.
- **Measure:** Resume latency
- **Pass:** < 500ms resume, position maintained (within 1s)
- **Metrics:** `resumeLatencyMs`, `positionDriftMs`

### 2.5 — Volume control
- **Action:** Check initial volume level, adjust slider
- **Measure:** Volume value in audio element
- **Pass:** Initial volume > 0 (not muted), slider change reflects in audio.volume
- **Metrics:** `initialVolume`, `adjustedVolume`, `volumeMatch`

---

## Group 3: Playback — Track Advancement

### 3.1 — Next button (same album)
- **Action:** Playing track 1, click next
- **Measure:** Time to start track 2, verify same album
- **Pass:** < 2s, track 2 plays, queue stays in same album
- **Metrics:** `advanceTimeMs`, `correctNextTrack`, `sameAlbum`

### 3.2 — Previous button
- **Action:** Playing track 3, click previous
- **Measure:** Time to start track 2
- **Pass:** < 2s, track 2 plays
- **Metrics:** `advanceTimeMs`, `correctPrevTrack`

### 3.3 — Auto-advance on track end
- **Action:** Let a track play to completion (seek near end)
- **Measure:** Gap between track end and next track start
- **Pass:** < 3s gap, next track in album plays
- **Metrics:** `gapMs`, `correctNextTrack`, `stalls`

### 3.4 — Skip undownloaded tracks
- **Action:** Queue with mix of downloaded and pending tracks, advance to pending
- **Measure:** Behavior when hitting a 404 track
- **Pass:** Auto-advances to next playable track within 3s, no infinite loop
- **Metrics:** `skipTimeMs`, `tracksSkipped`, `audioErrors`

### 3.5 — Rapid skip (stress)
- **Action:** Click next 5 times quickly
- **Measure:** Final state after 3s
- **Pass:** Exactly one track playing, no audio overlap, no crash
- **Metrics:** `finalTrackCorrect`, `audioElementCount`, `consoleErrors`

---

## Group 4: Format Badges & Library State

### 4.1 — Library tracks show format badges
- **Action:** Navigate to a library album
- **Measure:** Count tracks with MP3/FLAC badges vs total tracks
- **Pass:** 100% of library tracks have format badges
- **Metrics:** `totalTracks`, `badgedTracks`, `badgeTypes`

### 4.2 — Badge update after download
- **Action:** Play an undownloaded album, wait for YT download to complete
- **Measure:** Time from download complete (activity log) to badge appearing in UI
- **Pass:** Badge appears within 30s without manual refresh
- **Metrics:** `badgeAppearTimeMs`, `requiredRefresh`

### 4.3 — Badge update after upgrade
- **Action:** After upgrade pipeline replaces MP3 with FLAC
- **Measure:** Badge changes from MP3 to FLAC in UI
- **Pass:** Badge updates without page refresh
- **Metrics:** `badgeUpdateTimeMs`, `correctFormat`, `requiredRefresh`

### 4.4 — Mixed format album
- **Action:** View album with both MP3 and FLAC tracks
- **Measure:** Each track shows correct individual badge
- **Pass:** MP3 tracks show amber badge, FLAC show green
- **Metrics:** `mp3Count`, `flacCount`, `incorrectBadges`

---

## Group 5: Queue & Playlist Behavior

### 5.1 — Queue persistence across navigation
- **Action:** Play track, navigate to different album view, come back
- **Measure:** Playback continues uninterrupted during navigation
- **Pass:** Audio never pauses, now-playing bar stays consistent
- **Metrics:** `playbackInterrupted`, `queueLength`

### 5.2 — Replace queue (play different album)
- **Action:** Playing Animals track 3, click play on Sehnsucht
- **Measure:** Queue replaces cleanly
- **Pass:** Sehnsucht track 1 plays, no Animals tracks in queue
- **Metrics:** `transitionTimeMs`, `ghostTracks`, `correctAlbum`

### 5.3 — Rapid track clicking
- **Action:** Click 5 different tracks quickly in sequence
- **Measure:** Final state after 2s
- **Pass:** Only last clicked track plays, no overlap
- **Metrics:** `audioOverlap`, `finalTrackCorrect`

---

## Group 6: Downloads & Pipeline

### 6.1 — Play triggers download
- **Action:** Search for album not in library, click play
- **Measure:** Activity log shows YT download starting
- **Pass:** Download events appear within 5s of play click
- **Metrics:** `downloadTriggerMs`, `activityEvents`

### 6.2 — Upgrade auto-triggers after download
- **Action:** After full album YT download completes
- **Measure:** Upgrade job appears in activity log
- **Pass:** "Auto-queued upgrade" event within 30s of last track download
- **Metrics:** `upgradeQueuedMs`, `upgradeResult`

### 6.3 — Concurrent downloads
- **Action:** Start playing Album A, immediately search and play Album B
- **Measure:** Activity log shows both albums downloading
- **Pass:** Both download concurrently (interleaved events), neither blocks the other
- **Metrics:** `albumAEvents`, `albumBEvents`, `interleaved`

---

## Group 7: Error Recovery

### 7.1 — Search with no results
- **Action:** Search for "xyzqwerty123nonsense"
- **Measure:** Response time and UI state
- **Pass:** "No results" shown within 5s, no crash or hang
- **Metrics:** `searchTimeMs`, `showsNoResults`, `consoleErrors`

### 7.2 — Play deleted/missing track
- **Action:** If possible, play a track whose file was deleted from disk
- **Measure:** Error handling
- **Pass:** Shows error, auto-advances within 3s, telemetry captures audio_error
- **Metrics:** `errorTimeMs`, `autoAdvanced`, `telemetryError`

### 7.3 — Server restart recovery
- **Action:** Restart not-ify container while page is open
- **Measure:** Time until app reconnects and is functional
- **Pass:** SSE reconnects, library re-fetches, playback resumes within 30s
- **Metrics:** `reconnectTimeMs`, `sseReconnected`, `libraryRefreshed`

---

## Group 8: Activity Log & UI Feedback

### 8.1 — Activity log real-time updates
- **Action:** Trigger a download, watch activity tab
- **Measure:** Time from server event to UI display
- **Pass:** Events appear within 3s via SSE
- **Metrics:** `eventDelayMs`, `missedEvents`

### 8.2 — Upgrade tab shows pipeline
- **Action:** Filter to "upgrade" tab after an upgrade triggers
- **Measure:** Pipeline events visible
- **Pass:** Search, found/not-found, download progress visible
- **Metrics:** `eventsShown`, `categoriesCorrect`

### 8.3 — Cast disconnect banner auto-dismiss
- **Action:** Trigger a cast disconnect (or observe if one occurs)
- **Measure:** Banner display duration
- **Pass:** Banner disappears within 5s
- **Metrics:** `bannerDurationMs`

### 8.4 — Settings page loads all sections
- **Action:** Click gear icon, scroll through settings
- **Measure:** All sections render for admin user
- **Pass:** Last.fm, Real-Debrid, VPN, Soulseek, Music Library all visible
- **Metrics:** `sectionsVisible`, `loadTimeMs`

---

## Results Template

Each run produces a JSON file:

```json
{
  "version": "1.6.2",
  "testPlanVersion": "1.0",
  "timestamp": "2026-03-24T18:00:00Z",
  "environment": "staging",
  "url": "http://192.168.0.34:3000",
  "summary": {
    "total": 28,
    "passed": 0,
    "failed": 0,
    "skipped": 0,
    "avgLatencyMs": 0
  },
  "results": [
    {
      "id": "1.1",
      "name": "Home page load",
      "group": "Navigation & Rendering",
      "pass": true,
      "metrics": {
        "loadTimeMs": 1200,
        "libraryCount": 37,
        "consoleErrors": 0
      },
      "notes": ""
    }
  ]
}
```

---

## Trend Tracking

After each run, compare against previous runs:

```
| Version | Date       | Pass Rate | Avg Latency | Playback P50 | Stalls | Errors |
|---------|------------|-----------|-------------|--------------|--------|--------|
| 1.6.2   | 2026-03-24 |    /28    |       ms    |         ms   |        |        |
| 1.6.3   |            |    /28    |       ms    |         ms   |        |        |
```

Key metrics to trend:
- **Pass rate**: should increase or stay at 100%
- **Avg latency**: should decrease or stay stable
- **Playback P50**: median click-to-sound time, target < 1s for library tracks
- **Stalls**: audio_stall count per session, target 0
- **Errors**: console + telemetry errors per session, target 0
