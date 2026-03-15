# Notify MVP — Implementation Plan

> **Purpose:** This is the build plan for Claude Code (Sonnet) to execute. Each task is self-contained with clear inputs, outputs, and acceptance criteria. Work can stop and resume at any task boundary.

> **Current status:** Container running, health check working on port 3000.

---

## Environment Context

- **Project location:** `C:\Users\natha\.claude\notify`
- **Container:** Docker Compose, single Node.js 20 container
- **Server:** Express.js at `/app/server/src/` (live reload via nodemon)
- **Client:** React + Vite at `/app/client/src/` (not yet scaffolded)
- **Music storage:** `/app/music` (mapped to `./music/` on host)
- **Config storage:** `/app/config` (mapped to `./config/` on host)
- **Port:** 3000

---

## MVP Goal

A web UI where you type an artist/album/track name, see search results, click one, it downloads via Real-Debrid, and plays in the browser with play/pause and volume controls. That's the whole thing.

---

## Task 1: Real-Debrid Service

**What:** A server-side service that wraps the Real-Debrid API.

**API Reference:**
- Base URL: `https://api.real-debrid.com/rest/1.0/`
- Auth: Bearer token via header `Authorization: Bearer {token}`
- Token: User gets this from `https://real-debrid.com/apitoken`
- Rate limit: 250 requests/minute

**File:** `server/src/services/realdebrid.js`

**Functions to implement:**

1. `addMagnet(magnetLink)` — POST `/torrents/addMagnet` with magnet in body. Returns torrent `id`.

2. `selectFiles(torrentId, fileIds)` — POST `/torrents/selectFiles/{id}` with file IDs. Pass `"all"` to select everything. **Must be called after addMagnet before download starts.**

3. `getTorrentInfo(torrentId)` — GET `/torrents/{id}`. Returns status, file list, links. Statuses: `magnet_conversion`, `waiting_files_selection`, `downloading`, `downloaded`, `compressing`, `uploading`, `dead`, `error`.

4. `unrestrictLink(link)` — POST `/unrestrict/link` with the RD link from torrent info. Returns direct HTTP download URL, filename, filesize.

5. `waitForDownload(torrentId, pollIntervalMs = 2000)` — Polls `getTorrentInfo` until status is `downloaded`. Returns torrent info with links. Timeout after 5 minutes.

**Config:** Store the RD API token in `config/settings.json`. The service reads it on startup. Format:
```json
{
  "realDebrid": {
    "apiToken": "USER_PUTS_TOKEN_HERE"
  }
}
```

**Acceptance criteria:**
- [ ] Can add a magnet link and get a torrent ID back
- [ ] Can select files from the torrent
- [ ] Can poll until download completes
- [ ] Can get a direct download URL from the completed torrent
- [ ] Handles errors gracefully (bad token, dead torrent, timeout)

**Test:** Add a test endpoint `GET /api/test/rd-status` that calls the RD API to verify the token works (use `/user` endpoint). Returns user info or error.

---

## Task 2: Download Service

**What:** Downloads files from Real-Debrid direct URLs into the local music library.

**File:** `server/src/services/downloader.js`

**Functions to implement:**

1. `downloadFile(url, destPath)` — HTTP GET the direct URL from RD, stream to disk at `destPath`. Show progress. Return the local file path.

2. `downloadAlbum(torrentInfo)` — Given torrent info with multiple files (links array), download each audio file. Organize into `music/{artist}/{album}/` folder structure. Skip non-audio files (images, .nfo, .cue, etc.).

**Audio file extensions to keep:** `.mp3`, `.flac`, `.ogg`, `.m4a`, `.aac`, `.wav`, `.opus`

**File organization:** Use the torrent name to derive artist/album. If parsing fails, dump into `music/_unsorted/{torrent-name}/`.

**Acceptance criteria:**
- [ ] Can download a single file from an RD URL to local disk
- [ ] Can download all audio files from an album torrent
- [ ] Files end up organized in music/{artist}/{album}/ or music/_unsorted/
- [ ] Skips non-audio files
- [ ] Handles download failures gracefully

---

## Task 3: Music Search (Torrent Search)

**What:** Search for music torrents and return results with magnet links.

**File:** `server/src/services/search.js`

**Approach — use ApiBay (Pirate Bay API):**
- Endpoint: `GET https://apibay.org/q.php?q={query}&cat=100` (cat 100 = Music)
- No auth required
- Returns JSON array of objects with: `id`, `name`, `info_hash`, `seeders`, `leechers`, `size`, `num_files`
- Construct magnet link from `info_hash`: `magnet:?xt=urn:btih:{info_hash}&dn={name}`
- If apibay is down, return empty results (we'll add fallback sources later)

**Functions to implement:**

1. `searchMusic(query)` — Query apibay, parse results, return normalized array:
```json
[{
  "id": "apibay_12345",
  "name": "Artist - Album (2024) [FLAC]",
  "magnetLink": "magnet:?xt=urn:btih:...",
  "seeders": 45,
  "leechers": 3,
  "size": 524288000,
  "sizeFormatted": "500 MB",
  "source": "apibay"
}]
```

2. Sort results by seeders (descending). Filter out results with 0 seeders.

**API endpoint:** `GET /api/search?q={query}`

**Acceptance criteria:**
- [ ] Returns search results for a music query
- [ ] Results include magnet links
- [ ] Results are sorted by seeders
- [ ] Zero-seeder results are filtered out
- [ ] Handles apibay being unreachable (returns empty array, not error)

---

## Task 4: Orchestration — The Full Pipeline

**What:** Wire search → select → download → serve into a single flow triggered by the user.

**File:** `server/src/api/pipeline.js`

**Endpoints:**

1. `POST /api/download` — Body: `{ magnetLink, name }`. Kicks off the full pipeline:
   - Add magnet to RD
   - Get file list, auto-select audio files
   - Wait for download
   - Unrestrict links
   - Download files to local music library
   - Return the local file paths

   This is a long-running operation. Options:
   - **Simple (MVP):** Synchronous — the request hangs until done (could be 30-60 seconds). Return result when complete. Set a long timeout.
   - The client shows a loading state while waiting.

2. `GET /api/download/status/:id` — (Optional for MVP) Check progress of an in-flight download.

**Acceptance criteria:**
- [ ] A single POST kicks off the entire search → download → library pipeline
- [ ] Returns local file paths of downloaded audio files
- [ ] Works end-to-end: magnet in, playable files out

---

## Task 5: Library & Streaming

**What:** Serve audio files from the local library to the browser.

**File:** `server/src/api/library.js`

**Endpoints:**

1. `GET /api/library` — Scan the `music/` directory, return a list of all tracks:
```json
[{
  "id": "hash-of-filepath",
  "title": "Track Name",
  "artist": "Artist",
  "album": "Album",
  "path": "/api/stream/hash-of-filepath",
  "filename": "01 - Track Name.mp3",
  "format": "mp3"
}]
```

2. `GET /api/stream/:id` — Serve the audio file with proper headers (`Content-Type: audio/mpeg`, `Accept-Ranges: bytes` for seeking). Use `express.static` or manual file streaming with range request support.

**Metadata:** For MVP, parse what we can from filenames and folder structure. Don't worry about reading ID3 tags yet (that's a polish task).

**Acceptance criteria:**
- [ ] Library endpoint returns all audio files in the music directory
- [ ] Stream endpoint serves audio files playable in a browser
- [ ] Supports range requests (needed for seeking in the player)
- [ ] Scanning handles nested folders (artist/album/track)

---

## Task 6: Web Client — The UI

**What:** A React web app with search, results, and an audio player.

**Location:** `client/` directory

**Setup required:** Scaffold a Vite + React app in the client directory. The Docker setup needs updating to also serve the client (either Vite dev server proxied, or build the client and serve statically from Express).

**Simplest approach for MVP:** Build the client with Vite, output to `client/dist/`, serve statically from Express. Add to server:
```js
app.use(express.static(path.join(__dirname, '../../client/dist')));
```

**Components:**

1. **SearchBar** — Text input + search button. Calls `GET /api/search?q={query}`.

2. **SearchResults** — List of results showing name, seeders, size. Each has a "Download" button that calls `POST /api/download` with the magnet link.

3. **Player** — Fixed at bottom of screen. Uses HTML5 `<audio>` element.
   - Play/Pause button
   - Volume slider
   - Track name display
   - Progress bar (shows playback position)

4. **Library** — Simple list of downloaded tracks. Click to play. Loaded from `GET /api/library`.

**Page layout:**
```
┌─────────────────────────────┐
│  [Search bar]         [Go]  │
├─────────────────────────────┤
│  Search Results / Library   │
│  - Result 1    [Download]   │
│  - Result 2    [Download]   │
│  - Track 1     [Play]       │
│  - Track 2     [Play]       │
├─────────────────────────────┤
│  ▶ Track Name    ━━━━○━━━   │
│  🔊 ━━━○━━━                 │
└─────────────────────────────┘
```

**Acceptance criteria:**
- [ ] Can type a search query and see results
- [ ] Can click "Download" on a result and see it processing
- [ ] Can see downloaded tracks in the library
- [ ] Can click a track to play it
- [ ] Play/Pause works
- [ ] Volume slider works
- [ ] Basic but functional — doesn't need to look pretty

---

## Task 7: Docker Updates

**What:** Update Dockerfile and docker-compose.yml to support the full stack.

**Changes needed:**

1. **Dockerfile** — Add a build step for the client:
   - `cd client && npm run build` during image build
   - Serve `client/dist` from Express

2. **docker-compose.yml** — May need to add the client dist volume mount, or just rebuild on changes.

3. **Server index.js** — Serve the built client static files as a catch-all.

**Acceptance criteria:**
- [ ] `docker compose up --build` starts everything
- [ ] Visiting `http://localhost:3000` shows the web UI
- [ ] API endpoints work from the UI
- [ ] Live reload still works for server changes

---

## Build Order

```
Task 1 (Real-Debrid)     ← Start here. Riskiest, most unknown.
    ↓
Task 2 (Downloader)      ← Depends on Task 1 for URLs
    ↓
Task 3 (Search)           ← Independent, can be built in parallel with 1-2
    ↓
Task 4 (Pipeline)         ← Wires 1 + 2 + 3 together
    ↓
Task 5 (Library/Stream)   ← Depends on files existing from Task 2
    ↓
Task 6 (Web Client)       ← Depends on all API endpoints existing
    ↓
Task 7 (Docker updates)   ← Final integration
```

**Parallel opportunity:** Tasks 1-2 and Task 3 can be built at the same time since they're independent.

---

## How To Resume

If work stops mid-session:

1. Check which tasks are marked complete in this doc (checkboxes)
2. Read the current state of the codebase (`server/src/` and `client/src/`)
3. Pick up from the next incomplete task
4. Each task is self-contained — no implicit state between tasks

## Testing the Full Loop (End-to-End)

When all tasks are complete, the test is:

1. Open `http://localhost:3000`
2. Search for a well-known album (e.g., "Radiohead OK Computer")
3. Click Download on a result with good seeders
4. Wait for download to complete (should show progress/status)
5. Track appears in library
6. Click to play — audio plays in browser
7. Play/Pause and volume work

If this works, MVP is done.
