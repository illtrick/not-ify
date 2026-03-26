# v1.7.4 Staging Test Plan

**Pre-requisite:** Zero staging (delete all containers, config, music), run bootstrap, complete setup wizard.

---

## Group 1: Fresh Install Verification

### T1.1: BUG-001 — No stale session on fresh install
1. Complete setup wizard → "Start Listening"
2. **Expected:** Clean search screen, no albums, no queue, "No music yet" in sidebar
3. **Verify:** Open DevTools → Application → localStorage → should be empty or minimal

### T1.2: Bootstrap VPN credential collection
1. During bootstrap, select VPN → choose provider → enter creds
2. **Expected:** Gluetun container starts without crashing
3. **Verify:** `docker logs gluetun --tail 5` shows VPN connected, not "user is empty"

### T1.3: Bootstrap output is compact
1. Observe bootstrap output after "Starting services..."
2. **Expected:** Progress counter `[1/5] not-ify` instead of verbose Docker lines
3. **Expected:** Total setup time under 30s (was 60s+)

---

## Group 2: Player Architecture (ref-based)

### T2.1: BUG-014/018 — Play from search, controls work during download
1. Search for an album NOT in library (use a fresh artist)
2. Click play → tracks start downloading via YT
3. **While staying on the album page**, wait for MP3 badges to appear
4. Click different tracks, use next/prev buttons
5. **Expected:** Controls respond instantly, no freezing, no dual-highlight

### T2.2: BUG-019 — Track advance timing
1. While playing, click next rapidly 5 times
2. **Expected:** Each click advances one track, no 2-4s delays
3. **Expected:** No dual-highlight (only one track highlighted at a time)

### T2.3: BUG-020 — Controls remain functional after extended time
1. Stay on an album page for 5+ minutes during/after downloads
2. Click various tracks, use play/pause, next/prev
3. **Expected:** All controls remain functional without navigating away

### T2.4: BUG-011 — Pause is instant
1. Play a track, click pause
2. **Expected:** Audio stops immediately (within 200ms), no 2-4s delay
3. Repeat 5 times at different points in different tracks

---

## Group 3: Album Track Matching

### T3.1: BUG-022 — No cross-album bleed
1. Download 2+ albums by the same artist (e.g., search "Brother Ali")
2. Navigate between the albums via library sidebar
3. **Expected:** Each album shows ONLY its own tracks, no tracks from other albums

### T3.2: Track ordering from MB metadata
1. Download an album via YT (play all from search)
2. After download completes, navigate away and back to the album
3. **Expected:** Tracks appear in correct MB order (track 1, 2, 3...) not alphabetical
4. **Verify:** `curl -s http://192.168.0.34:3000/api/library | jq '.[] | select(.album=="ALBUM") | {title, track_number}'`

### T3.3: MB titles used over filename-derived titles
1. After YT download, check track titles in the library view
2. **Expected:** Correct capitalization from MusicBrainz (e.g., "Instrumental" not "instrumental")

---

## Group 4: Cover Art Performance

### T4.1: BUG-017 — Cover art loads within 10s
1. Search for an artist with many albums (e.g., "Radiohead", "Bjork")
2. Start timer when results appear
3. **Expected:** Cover art visible within 10-15s (was 60s+)
4. **Note:** First search may be slower (cold cache), second search should be instant

---

## Group 5: Service Configuration

### T5.1: BUG-013 — RD test connection
1. Go to Settings → Real-Debrid → enter token → Save → Test Connection
2. **Expected:** Shows "Premium — username, expires DATE" or a clear error
3. **Expected:** Does NOT show "VPN proxy is not running" (regression from v1.7.3)

### T5.2: Soulseek connection
1. Go to Settings → Soulseek section
2. **Expected:** Username pre-filled from CLI setup, "Connected to Soulseek" on test

---

## Group 6: Regression Checks

### T6.1: Library-first streaming
1. Play a track that's in the library
2. **Expected:** Streams from `/api/stream/:id` (check network tab), NOT from `/api/yt/stream/`

### T6.2: Session persistence (normal use)
1. Play an album, add tracks to queue
2. Close tab, reopen
3. **Expected:** Queue, current track, volume restored

### T6.3: Year in album header
1. Open a library album
2. **Expected:** Year shown in header (e.g., "Brother Ali · 2007 · 15 songs · 61 min")

---

## Test Methodology Notes

- **Start each search-based test from a FRESH search** — don't reuse albums across tests
- **Check badges immediately after download gate passes** — don't wait 10+ minutes
- **Click buttons as fast as a user would** — test rapid interactions
- **Watch for UI jank** during transitions (dual-highlight, flicker, stale data)
