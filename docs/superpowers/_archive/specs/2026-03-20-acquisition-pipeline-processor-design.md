# Acquisition Pipeline Processor — Design Spec

**Goal:** Wire the stub job processor into a fully functional background pipeline that searches for better quality sources, downloads via Real-Debrid, validates against MusicBrainz data, and replaces library files — with LLM-enhanced search and discography extraction.

**Context:** The codebase has all major pieces implemented but disconnected: quality-upgrader.js (enqueues jobs), job-queue.js (persists jobs), job-worker.js (polls jobs), pipeline.js (inline RD→download), downloader.js (file downloads + archive extraction), file-validator.js (MIME/ffprobe/ClamAV), llm.js (Ollama torrent name parsing), search.js (ApiBay queries), realdebrid.js (RD API). The job processor in index.js is an intentional stub that logs and skips all jobs.

---

## Architecture

Four changes connect the existing pieces:

1. **`job-processor.js`** (new) — routes jobs by type, orchestrates the RD→download→validate→replace pipeline
2. **`download-validator.js`** (new) — post-download validation using MusicBrainz track count + durations
3. **`search.js` enhancement** — LLM query expansion + LLM-assisted result ranking
4. **`downloader.js` enhancement** — discography-aware file selection at the RD step

No new DB tables, no new API endpoints, no new external dependencies.

---

## Section 1: Job Processor

**File:** `packages/server/src/services/job-processor.js`

Replaces the stub in index.js. A function that receives a job object and dispatches by type.

### `download` job flow

Payload: `{ magnetLink, artist, album, mbid?, rgid?, upgradeFrom?, isDiscography?, targetQuality? }`

1. **Check concurrency** — if a manual download is active (pipeline.js `activeDownload`), re-queue the job with 60s delay. Prevents competing for RD API and disk I/O.
2. **Add magnet to RD** — `rd.addMagnet(magnetLink)`
3. **Poll RD** until status = `waiting_files_selection` (2s interval, 2min timeout). Call `rd.getTorrentInfo(torrentId)` to retrieve the file list with IDs, paths, and sizes.
4. **File selection** — inspect RD file list from step 3:
   - If `isDiscography` or file paths show multiple album folders: token-match folder names against target album, select only matching folder's audio files
   - Otherwise: select all audio files (filter by extension from file paths)
   - Skip non-audio files (artwork, .nfo, .txt, .cue)
   - Call `rd.selectFiles(torrentId, '1,3,7')` with comma-separated file IDs (not `'all'`)
5. **Poll RD** until status = `downloaded` (2s interval, 5min timeout)
6. **Unrestrict links** — `rd.unrestrictLink()` for each link in the torrent's `links[]` array
7. **Download to staging** — `downloader.downloadFile()` to `MUSIC_DIR/_staging/Artist/Album/`
8. **Extract archives** — if .rar/.zip downloaded, extract with `downloader.extractArchive()`, then apply album folder matching to extracted contents
9. **File validation** — `fileValidator.validateFile()` on each audio file (size + MIME + ffprobe + ClamAV). Reject files that fail.
10. **Download validation** — `downloadValidator.validate()` compares files against MusicBrainz release data (see Section 2). Returns confidence score.
11. **Replace or reject:**
    - High/medium confidence (score < 0.40): move files from staging to `MUSIC_DIR/Artist/Album/`, replacing originals
    - No confidence (score >= 0.40): delete staging dir, fail the job with reason
12. **Cleanup** — delete `_staging/Artist/Album/` dir, call `rd.deleteTorrent(torrentId)` (fire-and-forget)

Activity log entries at each step for observability.

### Job timeout

The default `JOB_TIMEOUT` (10 min) in job-worker.js is too short for large FLAC downloads. Increase to 20 minutes for `download` type jobs. The job-worker should accept a per-type timeout override.

### `upgrade` jobs

Already handled by `quality-upgrader.tick()`. No changes needed — the upgrader dequeues upgrade jobs, calls `findBetterSource()`, and enqueues `download` jobs.

### Error handling

Fail fast on any step failure. The job-worker's existing retry backoff (1m, 5m, 15m, max 3 retries) handles re-attempts. Each retry is a fresh attempt from step 1 (RD may have cached the torrent by then, making subsequent attempts faster).

### Staging cleanup on startup

On server start, sweep `MUSIC_DIR/_staging/` and delete any directories older than 1 hour. This handles orphaned staging dirs from crashed jobs.

### Payload key standardization

`quality-upgrader.handleDiscographyDownload()` currently uses `targetArtist`/`targetAlbum` keys. Standardize to `artist`/`album` to match all other job payloads. The job processor reads `artist`/`album` consistently.

### Registration

In index.js, replace the stub:
```javascript
jobWorker.setProcessor(require('./services/job-processor').process);
```

---

## Section 2: Download Validator

**File:** `packages/server/src/services/download-validator.js`

Answers: "are these downloaded files actually the album we wanted?"

### Inputs
- Array of downloaded audio file paths
- MusicBrainz release ID (mbid) or release-group ID (rgid), or artist+album name for lookup

### Scoring (simplified beets model)

**Step 1: Get MusicBrainz release data**
- Use existing `musicbrainz.getReleaseTracks(mbid)` which returns tracks with `lengthMs` per track
- If mbid unavailable: call `musicbrainz.searchReleases('artist album')` to find best release mbid, then `getReleaseTracks(mbid)`
- If MusicBrainz lookup fails entirely, fall back to track-count-only validation against existing library files

**Step 2: Read downloaded file durations**
- Run ffprobe on each file (reuse `checkFfprobe` pattern from file-validator.js)
- Parse `format.duration` from JSON output

**Step 3: Compute match score (0.0 = perfect, 1.0 = no match)**

| Factor | Weight | Calculation |
|--------|--------|-------------|
| Track count | 0.3 | 0 if exact match, 0.5 if off by 1, 1.0 if off by 2+ |
| Duration match | 0.5 | Sort both lists by duration, greedy closest-match pairing (for each MB track, find closest unmatched downloaded file). Per-pair: 0 if delta < 10s, linear 0→1 for 10s→30s, 1.0 if > 30s. Average across all pairs. |
| Total duration | 0.2 | 0 if total delta < 30s, linear 0→1 for 30s→120s, 1.0 if > 120s |

**Step 4: Confidence thresholds**

| Score | Confidence | Action |
|-------|-----------|--------|
| < 0.15 | High | Auto-replace, log success |
| 0.15 – 0.40 | Medium | Replace, log warning for review |
| >= 0.40 | Low | Reject, fail job, delete staging files |

**Fallback when MusicBrainz unavailable:**
- Compare downloaded file count against existing library files for that album (±2 tolerance)
- If no existing files (new album), accept if file count >= 4 AND total duration is between 15–150 minutes (filters single tracks and massive compilations)
- Log that MB validation was skipped

### Return value
```javascript
{
  score: 0.08,
  confidence: 'high',  // high | medium | low
  trackCount: { expected: 12, actual: 12 },
  durationDelta: { avgPerTrack: 2.3, total: 27.6 },
  details: 'MB release matched, 12/12 tracks, avg delta 2.3s'
}
```

---

## Section 3: LLM-Enhanced Search

**File:** `packages/server/src/services/search.js` (enhanced)

Two new capabilities, both gracefully falling back when Ollama is unavailable.

### Query expansion

New function: `generateSearchQueries(artist, album, targetQuality)`

Calls `llm.js` with a prompt template that generates 3-5 search variations:
- Standard: `"artist album flac"`
- Without special characters: normalized artist/album
- Discography: `"artist discography flac"` or `"artist complete lossless"`
- Abbreviated: common shortenings
- Year-tagged: `"artist album 2004 flac"` if year known

The LLM understands music naming conventions better than regex — it knows "BoC" = "Boards of Canada", "RHCP" = "Red Hot Chili Peppers", etc.

**Fallback:** If LLM unavailable, generate 2 queries programmatically:
1. `"artist album flac"`
2. `"artist discography flac"`

### Result ranking

After collecting results from all queries, rank using the existing `llm.parseTorrentBatch()` to parse torrent names into structured data, then score:

| Factor | Weight | Calculation |
|--------|--------|-------------|
| Artist match | 0.35 | All artist name tokens present in parsed result (case-insensitive) |
| Album match | 0.35 | All album name tokens present, or isDiscography flag |
| Quality match | 0.15 | Parsed quality meets target (FLAC > target = full score) |
| Seeders | 0.15 | log2(max(seeders, 1)) / log2(max(max_seeders, 2)) — normalized, clamped to avoid log(0) |

Results scoring below 0.3 are discarded. Top result is selected.

**Fallback:** If LLM unavailable, use existing regex-based name cleaning from `api/search.js` and token-based matching (Headphones pattern: all artist+album words present in title, case-insensitive).

### Integration point

`quality-upgrader.findBetterSource()` calls `search()`. Enhance `search()` (or add a new `searchForUpgrade()`) to use query expansion + result ranking internally.

---

## Section 4: Discography Extraction

**File:** `packages/server/src/services/downloader.js` (enhanced)

### At RD file selection (job-processor step 3)

New function: `selectAlbumFiles(rdFiles, targetArtist, targetAlbum)`

RD returns files with paths like:
```
Artist Discography (FLAC)/2000 - Album Name/01 - Track.flac
Artist - Complete/Album Name [2004]/track01.flac
```

Logic:
1. Group files by their parent directory
2. For each directory name, normalize (strip year, brackets, quality tags)
3. Token-match normalized dir name against target album (case-insensitive)
4. If a directory matches: return those file IDs
5. If no directory matches but all files are in one flat folder: return all audio files (single-album torrent despite "discography" in name)
6. If multiple directories and no match: return empty (fail the job — wrong torrent)

### Post-download cleanup

After validation passes:
- Delete any files in staging that aren't part of the validated album
- Only validated audio files move to the library

### Archive handling

Existing `extractArchive()` already handles .rar/.zip. After extraction, run the same directory-matching logic on the extracted folder structure.

---

## Validation Before Implementation: LLM Training Circuit

Before implementing Section 3, run a validation circuit using Spotify Extended Streaming History data:

1. Load streaming history JSON files (2012-2026)
2. Extract unique artists, albums, tracks
3. Random sample: 50 artists, 30 albums, 20 songs
4. For each item, run 20 permutations through the LLM query expansion prompt
5. Execute each generated query against ApiBay
6. Measure: hit rate, false positive rate, queries needed per successful find
7. Compare LLM-generated queries vs naive `"artist album flac"` baseline
8. Tune prompt template based on results

**Success criteria:** LLM queries must achieve >= 60% hit rate on the sample and outperform the naive `"artist album flac"` baseline by >= 15 percentage points. False positive rate (results that don't contain the target) must be <= 10%.

This validates the approach with real listening data before committing to implementation.

---

## Note on Scoring Scales

Two independent scoring systems are used in this design — they are not comparable:

1. **Search result ranking** (Section 3): 0.0–1.0 where higher = better match. Results below 0.3 discarded.
2. **Download validation** (Section 2): 0.0–1.0 where lower = better match (distance metric, beets-style). Scores above 0.40 rejected.

---

## Files Changed

| File | Change |
|------|--------|
| `packages/server/src/services/job-processor.js` | **New** — job type router + download pipeline orchestration |
| `packages/server/src/services/download-validator.js` | **New** — MusicBrainz-based post-download validation |
| `packages/server/src/services/search.js` | Enhanced — LLM query expansion + result ranking |
| `packages/server/src/services/downloader.js` | Enhanced — `selectAlbumFiles()` for discography extraction |
| `packages/server/src/services/job-worker.js` | Per-type timeout override (20min for download jobs) |
| `packages/server/src/services/quality-upgrader.js` | Standardize `handleDiscographyDownload` payload keys to `artist`/`album` |
| `packages/server/src/index.js` | Wire `job-processor.process` replacing stub, add staging cleanup on startup |

---

## What's NOT in scope

- New UI components (existing activity log + job queue status in diagnostics provides visibility)
- New API endpoints (upgrader API already exists)
- New DB tables (job queue already has everything needed)
- Audio fingerprinting (future enhancement)
- Usenet/Soulseek/Prowlarr sources (future enhancement)
- Track-level downloads (album-level only for now)
