# Last.fm Library Import & Personalized Search — Design Spec

## Goal

Enable users to automatically build their music library from Last.fm listening history, and use that history to improve search result relevance. Includes prerequisite hardening of the download pipeline and search performance.

## Deliverables

Five deliverables, three global prerequisites (A, B, C) and two features (D, E). Implementation order: A → B → C → D → E.

---

## Deliverable A: Download Pipeline Hardening (global)

### Job Queue Schema

Define (or extend) the `job_queue` table:

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| user_id | TEXT | Who triggered the job |
| artist | TEXT | |
| album | TEXT | |
| magnet_link | TEXT | Torrent magnet URI (nullable — not all sources are torrents) |
| source_meta | TEXT | JSON: `{ quality, seeders, source_type, mbid, rgid }` |
| priority | TEXT | `manual` or `background` |
| status | TEXT | `pending`, `processing`, `completed`, `failed`, `skipped_duplicate`, `skipped_no_upgrade` |
| attempts | INTEGER | Default 0 |
| last_error | TEXT | Error message from most recent failure |
| created_at | INTEGER | Unix timestamp |
| updated_at | INTEGER | Unix timestamp |

Index: `(status, priority, created_at)` for efficient dequeue ordering.

**`job_log` table:**

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| job_id | INTEGER | FK to job_queue |
| artist | TEXT | Denormalized for query convenience |
| album | TEXT | Denormalized |
| attempt | INTEGER | Which attempt (1, 2, 3) |
| duration_ms | INTEGER | How long this attempt took |
| outcome | TEXT | `success`, `failed`, `timeout`, `stalled`, `skipped_duplicate`, `skipped_no_upgrade` |
| fail_reason | TEXT | Error details (nullable) |
| quality | TEXT | Detected quality of downloaded files (nullable) |
| created_at | INTEGER | Unix timestamp |

### Job Queue Consumer

Build a worker that dequeues and processes jobs from `job_queue`.

- Single worker, sequential processing
- Polls every 5 seconds when idle
- Two priority tiers:
  - **`manual`**: user-initiated downloads from search UI — always processed first
  - **`background`**: Last.fm auto-acquire and quality upgrader — FIFO together, no distinction between them

### Timeouts

| Scope | Timeout |
|-------|---------|
| End-to-end per job | 10 minutes |
| File download inactivity (no bytes received) | 60 seconds |
| RealDebrid API calls | 30 seconds |

### Retry Policy

- 3 attempts per job
- Backoff: 1 minute, 5 minutes, 15 minutes
- After 3 failures: mark as `failed`, move on
- Failed jobs remain in the table for manual review or future retry
- The upgrader (and any background process) must not dwell — if a source isn't available or stalls, move on and circle back later

### No-Dupes Rule

Before starting a download, check if `$MUSIC_DIR/Artist/Album/` exists with audio files. If so, skip and mark job as `skipped_duplicate`.

This check uses normalized artist/album name comparison (case-insensitive, stripped of special characters) to catch near-matches.

### No-Downgrade Rule

If the album exists on disk, compare quality of existing files against the incoming source. Only proceed if the new source is strictly higher in the quality hierarchy:

**FLAC > 320kbps > V0 > 256kbps > 192kbps > 128kbps > unknown**

If the new source is equal or lower quality, skip and mark as `skipped_no_upgrade`.

**Quality detection:**
- **Existing files on disk**: use `ffprobe` to read codec (flac vs mp3/aac) and bitrate. The app already uses ffprobe for validation in `file-validator.js`.
- **Incoming source**: parse quality from the torrent name string (e.g., "FLAC", "320", "V0"). The `source_meta.quality` field on the job stores this, populated during search result scoring which already classifies quality.
- **Fallback**: if quality cannot be determined for either side, treat as `unknown`. Unknown-to-unknown is a no-op (skip). Unknown existing + known incoming = proceed (any known quality beats unknown).

### Logging

Every job attempt logs to a `job_log` table:

```
{ jobId, artist, album, attempt, duration_ms, outcome, failReason, quality }
```

Outcomes: `success`, `failed`, `skipped_duplicate`, `skipped_no_upgrade`, `timeout`, `stalled`.

This data is retained for analysis and future tuning of retry/timeout parameters.

---

## Deliverable B: Search Performance (global)

Six improvements to make search faster. No new features — structural and tactical speed gains.

### 1. Parallelize Multi-Strategy Search

Currently, joined-query and fuzzy search run sequentially in `search.js`. Fire both simultaneously and deduplicate results downstream. Saves 1-2 seconds on searches that trigger both strategies.

### 2. Cache ApiBay Results

Add a 10-minute TTL cache for torrent search results. Repeated or similar searches return instantly from cache.

### 3. Prefetch Discography on Artist Click

When a user clicks an artist in search results, start fetching their album discography and track listings in the background. By the time they click into an album, the data is cached and ready.

### 4. Eliminate Redundant Artist Search

`useMoreByArtist` currently re-searches for an artist that's already present in `searchArtistResults`. Use the cached artist data from the initial search instead.

### 5. Parallelize Artist Page Loads

`getArtist()` and `getLastfmTopTracks()` currently run sequentially in `useArtistPage`. Fire both simultaneously.

### 6. Prefetch Track Listings on Album Hover

Trigger the MusicBrainz track fetch when the user hovers over an album card, so track data is cached by the time they click through to the detail view.

---

## Deliverable C: Last.fm Scrobble Sync (global)

### Purpose

Pull the user's entire Last.fm listening history into a local SQLite table. This data serves both library import (Deliverable E) and personalized search ranking (Deliverable D).

### Schema

**`scrobbles` table:**

| Column | Type | Notes |
|--------|------|-------|
| user_id | TEXT | FK to users |
| artist | TEXT | |
| album | TEXT | |
| track | TEXT | |
| played_at | INTEGER | Unix timestamp |

Indexes: `(user_id, artist)`, `(user_id, played_at)`.

Dedupe constraint: `UNIQUE(user_id, artist, track, played_at)` — prevents duplicate scrobbles.

**`artist_affinity` table (materialized view):**

| Column | Type | Notes |
|--------|------|-------|
| user_id | TEXT | FK to users |
| artist | TEXT | Normalized artist name |
| play_count | INTEGER | Total plays |
| last_played_at | INTEGER | Unix timestamp of most recent play |

Rebuilt after each sync. This is the fast lookup table used by search ranking.

### Auto-Sync Trigger

When a user completes Last.fm authentication (session key obtained), automatically start a full history sync in the background.

### Full Sync Flow

1. Paginate `user.getRecentTracks` (200 per page, oldest to newest)
2. Rate limit: 200ms between Last.fm API calls (5 req/sec). On HTTP 429, back off 30 seconds and retry.
3. Insert each scrobble into the `scrobbles` table (INSERT OR IGNORE for deduplication)
4. Track progress in `user_settings`: `{ state: 'syncing', total, fetched, startedAt }`
5. On completion: rebuild `artist_affinity` table, set state to `complete` with `lastSyncedAt` timestamp

The `artist_affinity` rebuild is a single SQL aggregation (`GROUP BY artist` with `COUNT` and `MAX`). Even at 500k scrobbles this completes in <100ms on better-sqlite3 (synchronous, no event loop blocking concern). The rebuild runs in the sync worker context, not in request handlers.

### Delta Sync

- Scheduled via `setInterval` on server startup, per authenticated Last.fm user, every 6 hours
- Fetches scrobbles since `lastSyncedAt`
- Appends to `scrobbles` table, incrementally updates `artist_affinity` (UPDATE existing rows, INSERT new artists)
- Users can also trigger a manual delta sync via a "Sync Now" button in the Last.fm settings section

### UI

In Settings, Last.fm section:
- During initial sync: "Syncing Last.fm history... 12,400 / 18,000 scrobbles"
- After sync complete: "Last synced: 2 hours ago" + "Sync Now" button

### Per-User Scope

- Scrobble data is per-user (each user has their own Last.fm account and history)
- `artist_affinity` is per-user
- Sync state/progress is per-user

---

## Deliverable D: Personalized Search Ranking (feature)

### Relevance Score

The current search pipeline has no unified relevance score. Define one by combining existing signals:

```
relevanceScore = (textMatch * 0.5) + (sourceScore * 0.3) + (popularity * 0.2)
```

Where:
- **textMatch** (0-1): normalized edit-distance or substring match confidence between query and result artist+album. The search API already computes this for MusicBrainz match scoring.
- **sourceScore** (0-1): quality tier (FLAC=1.0, 320=0.8, V0=0.7, 256=0.5, MP3=0.3, unknown=0.1) weighted by availability (seeders > 0).
- **popularity** (0-1): `log(1 + seeders) / log(1 + maxSeedersInResultSet)` — normalized within the result set.

Results without sources (MB-only or injected stubs) use `textMatch * 0.5 + popularity * 0.2` with popularity from MusicBrainz score.

### Ranking Formula

At search time, after external results (MusicBrainz + torrents + YouTube) return:

1. Compute `relevanceScore` for each result (as defined above)
2. Look up each result's artist in the user's `artist_affinity` table
3. Compute personal boost:

```
personalBoost = min(0.3, 0.1 * log2(1 + playCount) * decay(daysSinceLastPlay))

decay(days) = 1 / (1 + days / 90)
```

4. Minimum 2 plays required to activate any boost (prevents accidental plays from creating signal)
5. Apply: `finalScore = relevanceScore * (1 + personalBoost)`
6. Re-sort results by `finalScore`

### Tuning Parameters

| Parameter | Value | Purpose |
|-----------|-------|---------|
| Weight multiplier | 0.1 | Overall personalization strength |
| Max boost cap | 0.3 (30%) | Prevents personalization from overwhelming relevance |
| Decay half-life | 90 days | Recent listens matter more, old habits fade |
| Min plays threshold | 2 | Filters accidental/single plays |

### History Injection

In addition to boosting existing results, query `artist_affinity` for artists matching the search query (prefix/substring match). If a matching artist isn't already in the external results, inject it as a result stub (artist name only — full sources load when user clicks in).

**Limits**: inject at most **3** history-matched artists, ranked by `play_count`. Injected results are interleaved with external results based on their `finalScore` (they receive relevance score from text match + personal boost, but no source score since sources haven't been fetched yet).

This handles the core use case: searching "kiki" surfaces Kiki Rockwell for a user who has listened to her extensively, even if MusicBrainz doesn't return her for that partial query.

### No Visual Distinction

Boosted and injected results look identical to any other result. The ranking speaks for itself — no "from your history" badges or labels.

### Per-User Scope

- Search ranking is personalized per-user based on their individual `artist_affinity`
- The same search query may return different result ordering for different users

---

## Deliverable E: Library Import from Last.fm (feature)

### Purpose

One-click library seeding from a user's Last.fm listening history. Manual operation — user chooses when to run it and how far back to look.

### UI

In Settings, under the Last.fm section:
- "Import Library from Last.fm" button — **greyed out until scrobble sync is complete**
- Configurable day window input (default: 60 days)
- After import completes, show summary in plain language

### Import Flow

1. Query local `scrobbles` table: unique `(artist, album)` pairs from the last N days for this user
2. Dedupe against existing library on disk (normalized artist + album name comparison)
3. Dedupe against already-queued jobs in `job_queue`
4. For each remaining album: search for sources (MusicBrainz + torrents) with rate limiting (respect MB 1 req/sec)
5. Enqueue each found album as a `background` priority job in the job queue
6. Return immediate summary:

> "Found 45 albums by 23 artists. 12 already in library, 3 already queued, 30 queued for download."

### Async Downloads

Searching and enqueueing happens synchronously (user waits for the summary). Actual downloads happen asynchronously via the job queue worker (Deliverable A). The user does not wait for downloads to complete.

### Repeated Imports

A user may import 60 days on first run, then 180 days later. The no-dupes rule (Deliverable A) ensures albums already downloaded are skipped. The summary reflects this: "12 already in library" covers both previously imported and manually downloaded albums.

### Shared Library

Downloads go to the global `$MUSIC_DIR`. All users share the same library files. If Nathan imports Heilung - Ofnir and Sarah later imports her history which also includes it, the dupe check catches it — one copy on disk, both users can play it.

---

## What Is Per-User vs Shared

| Scope | Data |
|-------|------|
| **Per-user** | Last.fm account connection, scrobble history, artist affinity, import trigger + day window preference, import results summary, search ranking personalization |
| **Shared** | Music library on disk (`$MUSIC_DIR`), job queue, download pipeline, no-dupes/no-downgrade rules, search performance improvements |

---

## Out of Scope (future work)

- Audio fingerprint confirmation before deleting files during upgrade (noted for future)
- Scheduled/automatic library import (manual only for now)
- Collaborative filtering (users who listen to X also listen to Y)
- Quality upgrader implementation (referenced but separate deliverable)
