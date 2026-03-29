# Canonical Album Detail Endpoint

## Problem

6 different entry points (search, library, recently played, now playing, session restore, edition switch) each construct their own ad-hoc `selectedAlbum` object with different fields. Result: same album shows different data depending on how you navigated to it — wrong duration, missing year, no edition picker, inconsistent cover art.

## Design Principle

Every major music server (Navidrome, Jellyfin, Plex, Spotify, Funkwhale) uses the same pattern: **one canonical album detail endpoint, all entry points resolve to an album ID, same component fetches by ID every time.** No client-side assembly from heterogeneous caches.

## Solution

### `GET /api/album/:id`

Single endpoint that returns the definitive album object. Accepts multiple ID formats with fallback resolution:

```
1. Direct album PK lookup
2. rgid (MusicBrainz release group UUID)
3. mbid (MusicBrainz release UUID)
```

Returns album metadata + tracks with file status inline (SQLite JOIN is trivial at <10K albums). MB enrichment (editions) stays lazy/async on the client via existing `useMbTracks`.

### Response Shape

```json
{
  "id": "76203bd0-466b-4802-a7ca-9b0097a3f862",
  "artist": "Tool",
  "album": "Fear Inoculum",
  "year": 2019,
  "rgid": "76203bd0-466b-4802-a7ca-9b0097a3f862",
  "mbid": "464e0ca7-1055-4028-b5e3-ab83cbcbfd62",
  "coverArt": "/api/cover/rg/76203bd0-466b-4802-a7ca-9b0097a3f862",
  "trackCount": 10,
  "duration": 5200,
  "inLibrary": true,
  "tracks": [
    {
      "id": "abc123",
      "title": "Fear Inoculum",
      "artist": "Tool",
      "trackNumber": 1,
      "discNumber": 1,
      "duration": 622,
      "mbid": null,
      "file": {
        "format": "flac",
        "bitrate": 1411,
        "fileSize": 45000000,
        "filepath": "/app/music/Tool/Fear Inoculum/01 Fear Inoculum.flac"
      }
    }
  ]
}
```

When `file` is `null`, the track exists in MB metadata but has no local file (not downloaded).

### 404 Response

```json
{ "error": "not_found" }
```

Client falls back to MB-only flow for search results not yet in the database.

## ID Strategy

Already correct — `generateAlbumId(artist, album, rgid)` returns rgid when available, otherwise a 16-char hash. No change needed.

## Performance

- Single indexed JOIN: albums → album_tracks → track_files. Sub-millisecond at this scale.
- No application-level caching needed for single-album lookups.
- No filesystem checks on read — trust the database, validate on write (existing `syncAlbum` pattern).
- MB enrichment (editions) stays client-side and async — doesn't block the album detail response.

## Data Accuracy

- **Trust DB, validate on write.** `syncAlbum()` runs after every download. `scanAndSync()` on startup.
- **No re-scan on read.** Same as Navidrome and Jellyfin.
- **Format upgrades:** Download pipeline already calls `syncAlbum` + cache invalidation after completion.
- **MB metadata:** Cached with TTLs in `mb_cache` table. Editions fetched lazily by client.

## Migration: 3 Phases

### Phase 1: Add endpoint, migrate library entry point
- Add `GET /api/album/:id` using existing `getAlbumWithTracks` DB function
- Add `getAlbumByAnyId(id)` helper to db.js (chains 3 existing lookups)
- Change `openAlbumFromLibrary` to call the endpoint by album ID
- Other 5 entry points unchanged — zero risk

### Phase 2: Migrate remaining entry points
- `openRecentlyPlayed` → resolve by rgid through the endpoint
- `openAlbumFromSearch` → check endpoint first (by rgid), fall back to MB flow if 404
- `goToCurrentAlbum` → use album ID from current track
- Session restore → validate stored album against endpoint

### Phase 3: Remove ad-hoc construction
- Replace 6 different `setSelectedAlbum({...})` calls with one `openAlbum(id)` function
- Remove `fromSearch` flag — replace with `inLibrary` boolean from endpoint
- Remove `sources` from album object — attach separately when needed for download UI
- AlbumView renders based on data presence, not navigation context

## Edition Picker: Guaranteed Visible

The edition picker currently doesn't show because the condition requires `fromSearch || mbid || rgid`, and library/recently-played albums lack these fields.

**Fix in Phase 3:** Remove `fromSearch` from AlbumView entirely. The edition picker condition simplifies to:
```javascript
mbEditions?.length > 1
```

Since `mbEditions` only populates when `useMbTracks` loads MB data (which requires `rgid` on the album object), and the canonical endpoint always returns `rgid` when available, the picker will show from every entry point.

**Quick fix in Phase 1 (to ship immediately):** Change the condition from:
```javascript
mbEditions?.length > 1 && (fromSearch || selectedAlbum.mbid || rgid)
```
to:
```javascript
mbEditions?.length > 1
```
This is safe right now because `mbEditions` is only populated when MB data loads.

## File Organization: End-to-End Confirmation

**All editions land in the same folder.** Verified:

1. `resolveAlbumDir(rgid, artist, album)` finds existing folder by rgid DB lookup (indexed, O(1))
2. Standard CD downloads to `/app/music/Tool/Fear Inoculum/`
3. Later Digital Media download → same rgid → same folder → adds 3 missing interludes
4. Later Deluxe download → same rgid → same folder → `replaceTracksIfBetter()` handles conflicts:
   - Same track, higher quality → replaces
   - New track → adds
   - Same track, lower quality → skips

**Multi-disc duplicate track names** handled by `replaceTracksIfBetter()`:
- Matches by track number first, then title, then duration (5-sec tolerance)
- Disc 1 "Fear Inoculum" (track 1) and Disc 2 "Fear Inoculum" (track 1) disambiguated by title context when track numbers collide
- Both stored in `album_tracks` with `disc_number: 1` and `disc_number: 2`

**Library scanner picks up new files** via `syncAlbum(artist, album)` called after every download completion. The scanner reads `.metadata.json` for MB track data, enriches scanned tracks, and upserts into `album_tracks` + `track_files`.

## What Does NOT Change

- `resolveAlbumDir` — still rgid-based folder resolution
- `useMbTracks` — still fetches editions and MB track data
- Cover art — still rgid-based with per-release fallback
- Download pipeline — still uses the same folder resolution
- `.metadata.json` — unchanged
- `replaceTracksIfBetter` — still handles quality comparison and dedup

## Files to Modify

| Phase | File | Change |
|-------|------|--------|
| 1 | `packages/server/src/services/db.js` | Add `getAlbumByAnyId()` |
| 1 | `packages/server/src/api/library.js` | Add `GET /api/album/:id` endpoint |
| 1 | `packages/client/src/App.jsx` | Change `openAlbumFromLibrary` to fetch by ID |
| 1 | `packages/shared/src/api-client.js` | Add `getAlbum(id)` function |
| 1 | `packages/client/src/components/AlbumView.jsx` | Fix edition picker condition (quick fix) |
| 2 | `packages/client/src/App.jsx` | Migrate remaining entry points to `openAlbum(id)` |
| 3 | `packages/client/src/App.jsx` | Remove ad-hoc construction, single `openAlbum(id)` |
| 3 | `packages/client/src/components/AlbumView.jsx` | Remove all `fromSearch` conditionals |

## Verification

1. `cd packages/server && npx jest --no-cache` — all tests pass
2. `curl /api/album/{rgid}` returns complete album with tracks and file status
3. Click album from library sidebar → same data as from search → same as recently played
4. Edition picker visible from ALL entry points (library, search, recently played, now playing)
5. Year, duration, cover art consistent everywhere
6. Switch edition → correct tracklist with disc headers
7. Download from different editions → all files land in same folder
8. Upgrade (MP3 → FLAC) → same folder, files replaced by quality comparison
