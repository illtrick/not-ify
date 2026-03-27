# Metadata Architecture Redesign

## Problem Statement

Not-ify's current architecture treats the **filesystem as the source of truth** for album/track metadata. Every time a track downloads, `syncAlbum()` scans the directory, reads file metadata, and rebuilds the database. This causes:

1. **VA albums fragment** — same album splits into multiple library entries by per-track artist
2. **Metadata is volatile** — album name, track count, duration change as files download
3. **Cross-album bleed** — tracks from different albums appear in wrong album views
4. **Duration recalculated on every page load** — should be constant
5. **Track order depends on downloads** — partially downloaded albums show wrong ordering

## User Expectations

> An album and its data should be **constant** after creation. Album name, artist, track names, track numbers, track duration, album duration, album art, genres — none of this should change. Download/availability status is **decoupled** and should never break core metadata. Compilations and soundtracks stay intact and aren't fragmented.

## How The Big Three Handle This

### Plex (cleanest separation)
Three-layer model:
- **`metadata_items`** — logical metadata (title, artist, year, duration, external guid). Exists independently of files.
- **`media_items`** — technical specs (codec, bitrate). Linked to metadata.
- **`media_parts`** — physical files on disk (path, size). Linked to media.

### Navidrome (most sophisticated artist handling)
- **`album`** table with `album_artist` field + `compilation` boolean
- **`media_file`** table with both `artist` (track) and `album_artist` (for grouping)
- **`Participants`** role-based system (artist, album_artist, composer, producer, etc.)
- **`missing`** boolean — preserves metadata when files disappear
- Uses embedded file tags as source of truth, but preserves user data (ratings, play counts) across file changes

### Jellyfin
- `AlbumArtists[]` on both `Audio` and `MusicAlbum` entities
- `Artists[]` for per-track artists
- `ProviderIds` dictionary for MusicBrainz IDs
- Duration stored per-track, album duration computed from children

## Proposed Not-ify Architecture

### Principle: MusicBrainz is the source of truth for metadata. Filesystem is only for availability.

### New Schema

```sql
-- Albums: constant metadata from MusicBrainz, created once
CREATE TABLE IF NOT EXISTS albums (
  id TEXT PRIMARY KEY,              -- mbid or rgid
  title TEXT NOT NULL,
  album_artist TEXT NOT NULL,       -- "Khruangbin", "Various Artists", etc.
  year INTEGER,
  track_count INTEGER,
  duration INTEGER,                 -- total seconds, from MB
  mbid TEXT,                        -- MusicBrainz release ID
  rgid TEXT,                        -- MusicBrainz release group ID
  cover_art_url TEXT,               -- cached cover art path or URL
  genres TEXT,                      -- JSON array
  compilation INTEGER DEFAULT 0,   -- 1 for VA/soundtrack/compilation
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Tracks: constant metadata from MusicBrainz, created once per album
CREATE TABLE IF NOT EXISTS album_tracks (
  id TEXT PRIMARY KEY,              -- stable track ID (artist|album|title hash)
  album_id TEXT NOT NULL REFERENCES albums(id),
  title TEXT NOT NULL,
  artist TEXT NOT NULL,             -- per-track artist (may differ from album_artist)
  track_number INTEGER NOT NULL,
  disc_number INTEGER DEFAULT 1,
  duration INTEGER,                 -- seconds, from MB
  mbid TEXT,                        -- MusicBrainz recording ID
  created_at INTEGER DEFAULT (unixepoch())
);

-- Files: mutable state — what's actually on disk
-- Decoupled from metadata. A track can exist in album_tracks with no file.
CREATE TABLE IF NOT EXISTS track_files (
  track_id TEXT PRIMARY KEY REFERENCES album_tracks(id),
  filepath TEXT NOT NULL UNIQUE,
  format TEXT NOT NULL,             -- mp3, flac, m4a, etc.
  bitrate INTEGER,
  file_size INTEGER,
  file_duration REAL,               -- actual file duration (may differ from MB)
  downloaded_at INTEGER DEFAULT (unixepoch()),
  scan_status TEXT DEFAULT 'clean', -- clean, pending_scan, infected, scan_failed
  updated_at INTEGER DEFAULT (unixepoch())
);
```

### Key Design Decisions

**1. Albums created from MusicBrainz at search/play time, NOT from filesystem**

When a user views an album from search results, we already have all the MB metadata. At that point we INSERT the album + all tracks into `albums`/`album_tracks`. This happens BEFORE any download. The metadata is locked in.

**2. Downloads only touch `track_files`**

When a YT download or torrent download completes:
- Match the file to an existing `album_tracks` row by title/track_number
- INSERT/UPDATE `track_files` with the filepath, format, bitrate, etc.
- Never modify `albums` or `album_tracks`

**3. Album artist is always from MusicBrainz**

For compilations/soundtracks: `album_artist = "Various Artists"` (from MB's `artist-credit` on the release). Per-track artists are in `album_tracks.artist`.

For normal albums: `album_artist = "Khruangbin"` and all tracks also have `artist = "Khruangbin"`.

**4. Availability is a JOIN, not a column**

```sql
-- Get album view with availability
SELECT
  t.track_number, t.title, t.artist, t.duration,
  f.format, f.filepath IS NOT NULL AS available
FROM album_tracks t
LEFT JOIN track_files f ON f.track_id = t.id
WHERE t.album_id = ?
ORDER BY t.disc_number, t.track_number;
```

Track 7 might be downloaded (has a `track_files` row with format='mp3'), while track 8 is still pending (no `track_files` row). The album view always shows all 11 tracks in correct order regardless.

**5. Duration is stored, never calculated**

`albums.duration` = sum of `album_tracks.duration` values, computed once at album creation from MB data. Never recalculated.

**6. ClamAV status lives in `track_files.scan_status`**

- `clean` — passed ClamAV or scan skipped
- `pending_scan` — file exists, async scan not yet complete
- `infected` — ClamAV flagged it, file should be removed
- `scan_failed` — ClamAV unavailable, treat as clean

### Migration Path

1. Add `albums` and `album_tracks` tables (non-destructive)
2. Add `track_files` table
3. Migrate existing `tracks` data: split into `album_tracks` + `track_files`
4. Update `syncAlbum()` to only write to `track_files`
5. Update `/api/library` to read from `albums` JOIN `album_tracks` LEFT JOIN `track_files`
6. Update AlbumView to always render from `album_tracks` (constant), with badges from `track_files` (mutable)
7. Drop old `tracks` table after validation

### What This Fixes

| Bug | How it's fixed |
|-----|---------------|
| VA albums fragment by artist | `albums.album_artist` groups all tracks. Per-track artist is in `album_tracks.artist` |
| Metadata changes during download | Album/track metadata locked at creation. Downloads only touch `track_files` |
| Cross-album bleed | `album_tracks.album_id` is a hard FK. No fuzzy matching needed |
| Duration recalculated | `albums.duration` stored once. `album_tracks.duration` per track |
| Track order depends on downloads | `album_tracks.track_number` from MB, always present, always ordered |
| [unknown] track titles | Titles come from MB at album creation, not from YT metadata |
| Duplicate tracks from different YT sources | One `album_tracks` row per MB track. `track_files` is 1:1 |
