# Not-ify Testing Runbook

> **Version:** 2.0
> **Last updated:** 2026-03-25
> **Purpose:** Complete instructions for starting a clean testing session, connecting to all services, and running the full e2e test suite with metrics collection.

---

## 1. Environment Setup

### 1.1 Staging Server

| Item | Value |
|------|-------|
| **QNAP IP** | your-server-ip |
| **Not-ify URL** | http://your-server-ip:3000 |
| **slskd URL** | http://your-server-ip:5030 |
| **Gluetun control** | http://your-server-ip:8000 (host-only) |
| **Install dir** | /share/CACHEDEV3_DATA/Media/container-station-data/not-ify |
| **Music dir** | /share/CACHEDEV3_DATA/Media/container-station-data/Music |
| **Config dir** | (install dir)/config |

### 1.2 Connect to Staging API

```bash
# Verify staging is up and get version
curl -s http://your-server-ip:3000/api/health

# Check activity log
curl -s http://your-server-ip:3000/api/activity | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d);console.log(j.length+" entries");j.slice(-5).forEach(e=>console.log(new Date(e.ts).toLocaleTimeString(),e.category,e.level,(e.message||"").slice(0,100)))})'

# Check library
curl -s http://your-server-ip:3000/api/library | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d);const a=new Set(j.map(t=>t.artist+"|"+t.album));console.log(j.length+" tracks, "+a.size+" albums")})'

# Check telemetry
curl -s http://your-server-ip:3000/api/telemetry | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d);console.log("Events:",j.length);j.slice(-10).forEach(e=>console.log(new Date(e.ts).toLocaleTimeString(),e.event.padEnd(22),(e.trackId||"").slice(0,16),JSON.stringify(e.detail||{}).slice(0,80)))})'

# Check container status
curl -s http://your-server-ip:3000/api/containers/status

# Check all services
curl -s http://your-server-ip:3000/api/setup/services
```

### 1.3 SSH Access (if needed)

SSH access for the `claude` user is configured but **currently blocked by QNAP's SSHD** (non-admin users rejected despite AllowUsers config). Use the HTTP API for all monitoring.

If SSH is needed, ask the user to run commands via their admin session.

**Common SSH commands (run by user):**
```bash
# Container logs
docker logs not-ify --tail 20
docker logs slskd --tail 10
docker logs gluetun --tail 10

# Deploy update
cd /share/CACHEDEV3_DATA/Media/container-station-data/not-ify
docker compose --env-file .env pull not-ify
docker rm -f not-ify
docker compose --env-file .env up -d not-ify

# Full restart
docker compose --env-file .env down
docker compose --env-file .env up -d

# Check .env
cat .env

# Check music files
ls /share/CACHEDEV3_DATA/Media/container-station-data/Music/
```

### 1.4 Chrome MCP Setup

```
1. Call mcp__Claude_in_Chrome__tabs_context_mcp with createIfEmpty: true
2. Navigate to http://your-server-ip:3000
3. Wait 5s for page load
4. Take screenshot to verify
5. If user picker shows, click "Nathan"
6. Verify version in top-left corner matches expected
```

**Important:** After server updates, hard refresh the browser (Ctrl+Shift+R) or open a new tab. The client JS bundle is cached aggressively — stale bundles show old version numbers and miss new features.

**Tab ID tracking:** Save the tabId from tabs_context_mcp — all subsequent Chrome operations use this ID. If the tab becomes unresponsive, close it and create a new one.

### 1.5 Background Activity Monitor

Start this at the beginning of any test session to capture all server-side events:

```bash
LAST=0
for i in $(seq 1 180); do
  sleep 5
  DATA=$(curl -s http://your-server-ip:3000/api/activity 2>/dev/null)
  COUNT=$(echo "$DATA" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{console.log(JSON.parse(d).length)}catch{console.log(0)}})')
  if [ "$COUNT" != "$LAST" ]; then
    echo "$DATA" | node -e "
      let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
        const j=JSON.parse(d);
        j.slice($LAST).forEach(e=>{
          const ts=new Date(e.ts).toLocaleTimeString();
          const cat=(e.category||'?').padEnd(12);
          const lvl=(e.level||'?').padEnd(8);
          console.log(ts+' '+cat+lvl+(e.message||'').slice(0,120));
        });
      });
    "
    LAST=$COUNT
  fi
done
```

Run with `run_in_background: true` and `timeout: 600000`.

---

## 2. Pre-Test Checklist

Before running tests, verify:

- [ ] Staging version matches expected (check `/api/health`)
- [ ] All containers running (check `/api/containers/status` or ask user for `docker ps`)
- [ ] Chrome MCP connected and tab open to staging URL
- [ ] Activity monitor running in background
- [ ] Note current library state (track count, album count)
- [ ] Note current telemetry event count (for delta tracking)

---

## 3. Test Suite

### Test Execution Helpers

**Audio state check (reusable):**
```javascript
const a = document.querySelector('audio');
const f = document.querySelector('footer')?.innerText || '';
JSON.stringify({
  track: f.split('\n')[0],
  src: a?.src?.includes('/api/stream/') ? 'library' : a?.src?.includes('yt') ? 'youtube' : 'none',
  paused: a?.paused,
  time: Math.round((a?.currentTime||0)*10)/10,
  dur: Math.round((a?.duration||0)*10)/10,
  vol: a?.volume,
  ready: a?.readyState
})
```

**Search helper:**
```
1. Click Search button (ref_7 in sidebar)
2. Find search input: find "search input text field"
3. Set value via form_input
4. Start timer: window.__t0 = performance.now()
5. Click submit button: find "search submit button"
6. Wait 6s
7. Check results
```

**Play helper:**
```
1. Start timer: window.__playStart = performance.now()
2. Click track row or big play button
3. Wait 3s
4. Check audio state
```

---

### Group 1: Navigation & Rendering

| # | Test | Action | Pass Criteria | Metrics |
|---|------|--------|---------------|---------|
| 1.1 | Home page load | Navigate to root URL, wait 5s | Search visible, library count > 0, version correct | `loadTimeMs`, `libraryCount`, `version` |
| 1.2 | Search (cached) | Search for previously searched artist | Results in < 3s, album cards visible | `searchTimeMs`, `resultCount`, `artLoadRate` |
| 1.2b | Search (fresh) | Search for never-searched artist | Results in < 5s (cold MB cache) | `searchTimeMs`, `resultCount`, `artLoadRate` |
| 1.2c | Search (no results) | Search for "xyzqwerty123nonsense" | "No results" shown, no spinner stuck | `searchTimeMs`, `showsNoResults` |
| 1.3 | Album nav (search) | Click album card from search results | Track list renders < 3s, album art loaded | `navTimeMs`, `trackCount`, `hasArt` |
| 1.4 | Album nav (library) | Click album in library sidebar | Track list renders < 1s, format badges visible | `navTimeMs`, `trackCount`, `badgeCount` |
| 1.5 | Recently played nav | Click album in recently played | Opens album view (NOT search), correct album | `navTimeMs`, `correctAlbum` |
| 1.6 | Back button | From album view, click Back | Returns to previous view < 500ms | `navTimeMs`, `correctView` |

### Group 2: Playback — Basic

| # | Test | Action | Pass Criteria | Metrics |
|---|------|--------|---------------|---------|
| 2.1 | Play library (big button) | Click big play button on library album | Audio plays from `/api/stream/` < 2s, volume > 0 | `clickToPlayMs`, `isLibraryStream`, `volume` |
| 2.2 | Play library (track row) | Click specific track in list | Correct track plays, title in now-playing bar | `clickToPlayMs`, `correctTrack` |
| 2.3 | Play YT preview | Click play on non-library album | YT stream plays < 10s, download activity starts | `clickToPlayMs`, `isYtPreview`, `downloadStarted` |
| 2.4 | Pause and resume | Pause, wait 2s, resume | Position drift < 1s, resumes playing | `positionDriftS` |
| 2.5 | Volume control | Check initial volume | Volume > 0 (not muted) | `initialVolume` |

### Group 3: Track Advancement

| # | Test | Action | Pass Criteria | Metrics |
|---|------|--------|---------------|---------|
| 3.1 | Next (same album) | Click Next while playing | Next track in same album plays < 2s | `advanceTimeMs`, `correctNext`, `sameAlbum` |
| 3.2 | Previous | Double-click Previous quickly | Goes to previous track (single click restarts if > 3s) | `advanceTimeMs`, `correctPrev` |
| 3.3 | Auto-advance (library) | Seek to 5s before end, let track end | Next track starts < 1s gap | `gapMs`, `correctNext` |
| 3.3b | Auto-advance (YT preview) | Let YT track reach end | Next track starts (may be slower) | `gapMs`, `autoAdvanced` |
| 3.4 | Skip undownloaded | Queue with mix of downloaded/pending, advance to pending | Skips to next playable < 3s, no infinite loop | `skipTimeMs`, `tracksSkipped` |
| 3.5 | Rapid skip (5x) | Click Next 5 times quickly | Exactly one track playing, no overlap, no crash | `finalTrackCorrect`, `audioOverlap` |

### Group 4: Format Badges

| # | Test | Action | Pass Criteria | Metrics |
|---|------|--------|---------------|---------|
| 4.1 | Library badges | Open library album | 100% of tracks have format badges | `badgeRate`, `mp3Count`, `flacCount` |
| 4.2 | Badge after download | Play new album, wait for YT download | Badges appear without page refresh | `badgeAppearTimeMs`, `requiredRefresh` |
| 4.3 | Badge after upgrade | After upgrade pipeline replaces MP3→FLAC | Badge changes from MP3 to FLAC | `badgeUpdateTimeMs`, `correctFormat` |
| 4.4 | Mixed format album | View album with both MP3 and FLAC | Each track shows correct individual badge | `mp3Count`, `flacCount`, `incorrectBadges` |

### Group 5: Queue & Playlist

| # | Test | Action | Pass Criteria | Metrics |
|---|------|--------|---------------|---------|
| 5.1 | Queue persistence | Play track, navigate away, come back | Playback continues uninterrupted | `playbackInterrupted` |
| 5.2 | Replace queue | Playing Album A, click play on Album B | Album B plays, Next stays in Album B | `transitionTimeMs`, `ghostTracks` |
| 5.3 | Rapid track clicking | Click 5 different tracks quickly | Only last clicked plays, no overlap | `audioOverlap`, `finalTrackCorrect` |

### Group 6: Downloads & Pipeline

| # | Test | Action | Pass Criteria | Metrics |
|---|------|--------|---------------|---------|
| 6.1 | Play triggers download | Play non-library album | Download events in activity < 5s | `downloadTriggerMs` |
| 6.2 | Upgrade auto-triggers | After full YT download completes | "Auto-queued upgrade" in activity < 30s | `upgradeQueuedMs` |
| 6.3 | Concurrent downloads | Start playing Album A and Album B | Both download concurrently (interleaved events) | `interleaved` |

### Group 7: Error Recovery

| # | Test | Action | Pass Criteria | Metrics |
|---|------|--------|---------------|---------|
| 7.1 | No results search | Search for gibberish | "No results" shown, no crash | `searchTimeMs`, `showsNoResults` |
| 7.2 | Missing track | Play track whose file was deleted | Error shown, auto-advances < 3s | `errorTimeMs`, `autoAdvanced` |
| 7.3 | Server restart | Restart not-ify container while page open | Reconnects < 30s, library refreshes | `reconnectTimeMs` |

### Group 8: Activity & UI Feedback

| # | Test | Action | Pass Criteria | Metrics |
|---|------|--------|---------------|---------|
| 8.1 | Activity log updates | Trigger download, watch activity tab | Events appear via SSE < 3s | `eventDelayMs` |
| 8.2 | Upgrade tab | Filter to upgrade after trigger | Pipeline events visible | `eventsShown` |
| 8.3 | Cast disconnect dismiss | Trigger cast disconnect | Banner disappears < 5s | `bannerDurationMs` |
| 8.4 | Settings all sections | Open settings as admin | All 6 sections visible (Playback, Last.fm, RD, VPN, Soulseek, Music Library) | `sectionsVisible` |

### Group 9: UX Quality

| # | Test | Action | Pass Criteria | Metrics |
|---|------|--------|---------------|---------|
| 9.1 | Gapless (library) | Seek near end, let auto-advance | Gap < 1000ms between tracks | `gapMs` |
| 9.2 | Session persistence | Close tab, reopen | Recently played restored, library correct | `recentlyPlayedRestored` |
| 9.3 | Track order | Open known album | Track numbers sequential, no gaps | `sequential`, `duplicates` |
| 9.4 | Cover art rate | Search for 5 diverse artists | > 90% albums have loaded art | `artLoadRate` |
| 9.5 | No infinite loading | Trigger search, wait 30s | No spinner stuck | `maxLoadingMs` |
| 9.6 | Scrobble fires | Play > 30s, check Last.fm | Scrobble event fires | `scrobbleFired` |
| 9.7 | Double-click debounce | Double-click play button | Single playback, no overlap | `playRequestCount` |
| 9.8 | Mobile responsive | Resize to 375x812 | All core controls accessible | `controlsAccessible` |

---

## 4. Diversity Requirements

Each test run must include:

**Albums (minimum 3):**
- 1x library album (already downloaded, has badges)
- 1x fresh search album (never cached, different artist each run)
- 1x partially downloaded album (if available)

**Artist rotation:**
Run 1: Radiohead, Björk | Run 2: Tool, Nina Simone | Run 3: Aphex Twin, Massive Attack | Run 4: Daft Punk, Portishead | Run 5: Tame Impala, Burial

**Actions per run:**
- At least 1 search → album → play (cold path)
- At least 1 library → play (warm path)
- At least 1 recently played → play
- At least 1 next/prev
- At least 1 album switch mid-playback

---

## 5. Metrics Collection

### From Telemetry API

```bash
curl -s http://your-server-ip:3000/api/telemetry | node -e '
let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{
  const j=JSON.parse(d);

  // Play latencies
  const plays = j.filter(e=>e.event==="play_requested");
  const playing = j.filter(e=>e.event==="audio_playing");
  const playLatencies = plays.map(p => {
    const n = playing.find(a => a.ts > p.ts && a.ts - p.ts < 30000);
    return n ? n.ts - p.ts : null;
  }).filter(Boolean);
  const p50 = playLatencies.sort((a,b)=>a-b)[Math.floor(playLatencies.length/2)] || 0;

  // Gaps
  const ended = j.filter(e=>e.event==="audio_ended");
  const gaps = ended.map(e => {
    const n = playing.find(p => p.ts > e.ts);
    return n ? n.ts - e.ts : null;
  }).filter(Boolean);

  // Stalls
  const stalls = j.filter(e=>e.event==="audio_stall").length;

  // Summary
  const types = {};
  j.forEach(e => { types[e.event] = (types[e.event]||0)+1; });

  console.log("=== Telemetry Summary ===");
  console.log("Total events:", j.length);
  console.log("Play latency P50:", p50+"ms");
  console.log("Gapless gaps:", gaps.map(g=>g+"ms").join(", ") || "none");
  console.log("Stalls:", stalls);
  console.log("Event types:", Object.entries(types).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+"="+v).join(", "));
});
'
```

### From Chrome JS

After each test, collect audio state:
```javascript
const a = document.querySelector('audio');
JSON.stringify({ src: a?.src?.slice(-30), paused: a?.paused, time: Math.round((a?.currentTime||0)*10)/10, vol: a?.volume, ready: a?.readyState })
```

---

## 6. Results Format

Save to `docs/testing/test-results/v{VERSION}-{TIMESTAMP}.json`:

```json
{
  "version": "1.6.8",
  "testPlanVersion": "2.0",
  "timestamp": "2026-03-25T...",
  "environment": "staging",
  "summary": {
    "total": 36,
    "tested": 0,
    "passed": 0,
    "failed": 0,
    "skipped": 0
  },
  "metrics": {
    "playLatencyP50Ms": 0,
    "gaplessP50Ms": 0,
    "searchLatencyP50Ms": 0,
    "stalls": 0,
    "coverArtRate": "0%"
  },
  "results": []
}
```

### Trend Table

Update after each run:

```
| Version | Date | Pass Rate | Play P50 | Gap P50 | Stalls | Art Rate |
|---------|------|-----------|----------|---------|--------|----------|
| 1.6.2   | 3/24 |   5/7     |     4ms  |    4ms  |   1    |    —     |
| 1.6.3   | 3/24 |  24/30    |     4ms  |    4ms  |   1    |   97%    |
| 1.6.5   | 3/25 |  28/32    |     4ms  |    3ms  |   3    |   97%    |
| 1.6.8   |      |    /36    |      ms  |     ms  |        |          |
```

---

## 7. Automated Test Suite

### Overview

Run before manual testing to verify core pipeline logic. All tests use real filesystem and real SQLite — no mocked FS.

```bash
# Full server test suite (575 tests, ~3s)
cd packages/server && npx jest --testPathIgnorePatterns='search.test'

# Pipeline e2e only (16 tests, <1s)
cd packages/server && npx jest __tests__/services/pipeline-e2e.test.js --verbose
```

### Test Coverage Map

| Test File | Tests | Scope |
|-----------|-------|-------|
| `pipeline-e2e.test.js` | 16 | **Full pipeline**: service pre-flight, RD torrent path, Soulseek path, metadata integrity, year COALESCE, upgrade flow |
| `pipeline-integration.test.js` | 1 | Job queue → processor wiring (mocked FS) |
| `job-queue.test.js` | 26 | Enqueue, dequeue, retries, dedup |
| `job-processor.test.js` | 14 | Download processing, per-track quality replacement |
| `quality-upgrader.test.js` | 24 | Upgrade detection, source finding, tick cycle |
| `file-validator.test.js` | 12 | Size, MIME, ffprobe, ClamAV checks |
| `download-validator.test.js` | 15 | Track duration matching, MB validation |
| `soulseek.test.js` | 12 | slskd API integration |
| `library.test.js` | 19 | Library API, streaming, dedup |
| Other (27 files) | ~436 | DB, search, settings, DLNA, auth, etc. |

### Pre-flight Checks (in pipeline-e2e.test.js)

Before running manual e2e tests on staging, verify service connectivity:

| Check | What it validates |
|-------|-------------------|
| slskd API key auth | Not-ify can communicate with slskd container |
| slskd 401 detection | Wrong API key surfaces clear error |
| RD token auth | Real-Debrid API token works |
| RD expired token | Expired token returns 401 |
| VPN proxy unreachable | Clear "fetch failed" error when Gluetun is down |

### Pipeline E2E Checks

| Check | Path | What it validates |
|-------|------|-------------------|
| Download → validate → library → DB → streamable | RD torrent | Files land in correct dir, pass validation, sync to DB with all metadata, filepath exists on disk |
| Validation failure blocks library entry | RD torrent | Size/ffprobe gate prevents bad files from entering library |
| ClamAV deferred scan | RD torrent | Async scan runs after library sync, removes infected files |
| Upgrade MP3 → FLAC | RD torrent | DB updates format/filepath, old file replaced, new file streamable |
| Soulseek → staging → validate → library → DB | Soulseek | Full Soulseek flow with .metadata.json written |
| Non-audio file rejected | Soulseek | .exe and other non-audio blocked at validation |

### Metadata Integrity Checks

| Field | Verified | Used by UI |
|-------|----------|------------|
| `id` | Stable across format upgrades | Track streaming URL |
| `artist` | Stored and retrievable | Album header, search |
| `album` | Stored and retrievable | Album header, library |
| `title` | Stored and retrievable | Track list |
| `format` | Per-track (flac/mp3/etc.) | QualityBadge color |
| `filepath` | Points to real file on disk | `/api/stream/:id` |
| `file_size` | > 0 | Library stats |
| `year` | Stored, survives null re-sync (COALESCE) | Album header (offline-first) |
| `track_number` | Correct ordering | Track list order |
| `.metadata.json` | mbid, rgid, source, importedAt | Cover art, upgrade source |

---

## 8. Known Issues (as of v1.7.1)

| ID | Severity | Description | Status |
|----|----------|-------------|--------|
| BUG-001 | high | Session state (queue, album view) persists across clean reinstall | Open — needs client + server fix |
| BUG-007 | low | Gluetun VPN crashes on fresh install with no credentials | Open — should not start until configured |
| BUG-011 | medium | Intermittent pause delay (2-4s audio continues after clicking pause) | Open — investigating |
| BUG-012 | low | Soulseek 401 after bootstrap — API key mismatch between containers | Open — .env / slskd.yml sync issue |
| BUG-013 | low | RD "fetch failed" when VPN proxy (Gluetun) is down — error message unclear | Open — should say "VPN not configured" |
| NP-004 | medium | Audio autoplay blocked in new Chrome tab until user gesture | Workaround: click play/pause in player bar |
| KNOWN-001 | low | Multi-disc albums restart track numbering | Not fixed |

---

## 8. Quick Reference Commands

```bash
# Health check all services
echo "not-ify:" && curl -s http://your-server-ip:3000/api/health && echo "" && echo "services:" && curl -s http://your-server-ip:3000/api/setup/services && echo "" && echo "containers:" && curl -s http://your-server-ip:3000/api/containers/status

# Cover art spot check (30 albums)
# See docs/testing/cover-art-test.sh

# Deploy latest to staging (run on QNAP SSH)
cd /share/CACHEDEV3_DATA/Media/container-station-data/not-ify && docker compose --env-file .env pull not-ify && docker rm -f not-ify && docker compose --env-file .env up -d not-ify

# Clean staging (nuclear)
docker stop $(docker ps -q); docker rm $(docker ps -aq)
rm -rf /share/CACHEDEV3_DATA/Media/container-station-data/not-ify
docker pull ghcr.io/illtrick/not-ify:latest
docker run --rm --entrypoint cat ghcr.io/illtrick/not-ify:latest /app/scripts/bootstrap.sh > /tmp/bootstrap.sh
bash /tmp/bootstrap.sh
```
