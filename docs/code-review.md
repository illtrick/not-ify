# Not-ify Code Review

**Date:** 2026-03-27
**Version:** 1.7.13
**Scope:** Full codebase — server, client, shared, desktop, infra, tests

---

## Severity Legend

| Level | Meaning |
|-------|---------|
| **CRITICAL** | Security vulnerability or data-loss risk — fix before any public deploy |
| **HIGH** | Bug or design flaw that will bite users in normal usage |
| **MEDIUM** | Code smell, missing validation, or reliability gap |
| **LOW** | Style, maintainability, or minor optimization |

---

## 1. Security

### CRITICAL

| # | File | Line | Issue |
|---|------|------|-------|
| S1 | `server/src/api/library-config.js` | 68 | **Path traversal** — `path.resolve(requestedPath)` accepts user input without checking the resolved path stays within an allowed parent. `../../../etc/passwd` reads arbitrary files. Fix: validate `fullPath.startsWith(allowedRoot)`. |
| S2 | `server/src/api/setup.js` | 87 | **Command injection** — `execSync(\`df -k "${musicDir}"\`)` interpolates user-controlled path into a shell command. Fix: use `execFileSync('df', ['-k', musicDir])`. |
| S3 | `server/src/services/file-validator.js` | 44, 60, 150 | **Command injection** — `execSync(\`file --mime-type -b "${filePath}"\`)`, `execSync(\`ffprobe ... "${filePath}"\`)`, `execSync(\`clamdscan ... "${filePath}"\`)` all interpolate file paths into shell strings. Filenames like `test"; rm -rf /; echo "` execute arbitrary commands. Fix: use `execFile()` with array args. |
| S4 | `server/src/services/container-manager.js` | 237 | **Heredoc injection** — API key interpolated into a YAML heredoc. A key containing `CFGEOF` breaks the heredoc boundary and injects arbitrary YAML. Fix: write file with `fs.writeFileSync()` instead of shell heredoc. |
| S5 | `server/src/services/container-manager.js` | 204-213 | **Env file injection** — User-controlled values written to `.env` without escaping. Keys/values with newlines can inject additional env vars. Fix: validate/escape values or use a proper env parser. |
| S6 | `desktop/src-tauri/tauri.conf.json` | 21 | **CSP disabled** — `"csp": null` leaves the desktop app open to XSS if the server is compromised. Fix: set a restrictive CSP policy. |
| S7 | `desktop/src-tauri/tauri.conf.json` | 40 | **Empty updater pubkey** — `"pubkey": ""` means updates have no signature verification. MITM can push malicious updates. Fix: generate and embed an Ed25519 public key. |
| S8 | `docker/Dockerfile` | 23-24 | **yt-dlp downloaded without checksum** — `curl -L .../yt-dlp -o ...` with no hash verification. Fix: download and verify `.sha256` alongside the binary. |

### HIGH

| # | File | Line | Issue |
|---|------|------|-------|
| S9 | `server/src/api/setup.js` | 37-39 | **Race condition on account creation** — `getUserCount()` check is not atomic. Two simultaneous POST requests can both pass the `existingCount === 0` guard and create duplicate admin accounts. Fix: use a DB-level unique constraint or transaction. |
| S10 | `server/src/services/stream-auth.js` | 24-26 | **Unvalidated hex input** — `Buffer.from(sig, 'hex')` throws if `sig` is not valid hex, crashing the request instead of returning 403. Fix: wrap in try-catch or pre-validate hex format. |
| S11 | `shared/src/api-client.js` | 387-388 | **User ID in SSE query params** — SSE endpoints pass userId as a URL parameter. Leaks to proxy logs, browser history, and referrer headers. |

### MEDIUM

| # | File | Line | Issue |
|---|------|------|-------|
| S12 | `server/src/api/vpn-config.js` | 175 | Raw gluetun response body included in error response without sanitization — could leak internal service details. |
| S13 | `server/src/api/search.js` | — | No rate limiting on search endpoints. Parallel requests could trigger IP bans from MusicBrainz/YouTube. |
| S14 | `server/src/api/import.js` | 26 | `express.json({ limit: '50mb' })` on Spotify import — 50MB payload limit is excessive. |
| S15 | `server/src/services/library-check.js` | 13-15 | Same command injection pattern as S3 — `execSync(\`ffprobe ... "${filePath}"\`)`. |

---

## 2. Bugs

### HIGH

| # | File | Line | Issue |
|---|------|------|-------|
| B1 | `server/src/index.js` | 792 | **Wrong require path** — `require('./services/lastfm-client')` but the file is `./services/lastfm`. Will crash at runtime when `flushScrobbles()` fires. |
| B2 | `server/src/api/pipeline.js` | 203 | **`copyFiles()` not awaited** — Response sent as "complete" while files are still copying. Client sees success before download finishes. |
| B3 | `server/src/api/pipeline.js` | 30, 324, 340 | **Race condition on global state** — `activeDownload` and `bgDownload` are global mutable variables with no synchronization. Two concurrent POST requests can corrupt state. |
| B4 | `client/src/hooks/useCast.js` | 38-114 | **Stale closure** — `prevState` and `prevPosition` are never reset when `activeDevice` changes. Reconnecting to the same device uses stale position data, causing duplicate track skips. |
| B5 | `client/src/hooks/useSession.js` | 45-46 | **Dependency loop** — `Object.values(sessionData)` creates a new array every render, causing `saveSession()` to fire continuously instead of only on real changes. |
| B6 | `server/src/services/realdebrid.js` | 15-34 | **Token not persisted** — `setToken()` updates in-memory cache but doesn't write to DB. Token lost on server restart. |

### MEDIUM

| # | File | Line | Issue |
|---|------|------|-------|
| B7 | `server/src/api/import.js` | 121 | `parseInt(req.params.index)` not validated — NaN used as array index without bounds check. |
| B8 | `server/src/api/youtube.js` | 189 | String vs number comparison — `"02"` !== `"2"` in track number matching. |
| B9 | `server/src/middleware/setup.js` | 8-9 | `_setupComplete` cache never invalidated — if setup completes mid-request, subsequent requests remain blocked until restart. |
| B10 | `server/src/services/scrobble-sync.js` | 20-34 | `result.tracks.filter()` — no null check on `result.tracks` before calling `.filter()`. |
| B11 | `client/src/hooks/useDownload.js` | 315 | `api.startYtAlbumDownload()` called without `.catch()` — failed YouTube album downloads silently ignored. |
| B12 | `client/src/components/PlayerBar.jsx` | 42, 109 | Mobile seek doesn't check if casting — seek applied to local audio instead of cast device. |
| B13 | `desktop/src-tauri/tauri.conf.json` | 4 vs `package.json:4` | Version mismatch — Tauri config says `1.2.0`, package.json says `1.7.13`. |

---

## 3. Error Handling

### HIGH

| # | File | Line | Issue |
|---|------|------|-------|
| E1 | `client/src/App.jsx` | — | **No Error Boundary** — any component render crash takes down the entire app. |
| E2 | `server/src/api/setup.js` | 55-96 | No try-catch around `execSync('df ...')` — if `df` fails, endpoint crashes. |

### MEDIUM

| # | File | Line | Issue |
|---|------|------|-------|
| E3 | `server/src/api/pipeline.js` | 156, 216, 250, 295, 394, 434 | Empty `.catch(() => {})` blocks — errors silently swallowed across 6+ locations. |
| E4 | `server/src/api/youtube.js` | 213 | `catch { /* dir doesn't exist */ }` — hides permission-denied, disk-full, and other real errors. |
| E5 | `server/src/api/search.js` | multiple | Multiple empty `.catch(...)` blocks suppress search pipeline errors. |
| E6 | `server/src/services/job-processor.js` | 66 | `JSON.parse(job.payload)` without try-catch — corrupted payloads crash the worker. |
| E7 | `client/src/hooks/usePlayer.js` | 185 | `audio.play().catch(() => {})` — all play errors silently ignored. User clicks play, nothing happens, no feedback. |
| E8 | `client/src/hooks/useRecentlyPlayed.js` | 41 | SSE errors caught and silently reconnected — no user feedback when SSE is down. |

---

## 4. Performance & Resources

### HIGH

| # | File | Line | Issue |
|---|------|------|-------|
| P1 | `server/src/api/cast.js` | 389-393 | **SSE listener leak** — `dlna.on(...)` listeners never cleaned up if `req.on('close')` doesn't fire. After many connections, memory grows unbounded. |
| P2 | `client/src/hooks/useTrackDurations.js` | 20-42 | **Audio element leak** — creates `new Audio()` per track in a loop. 50-track album = 50 audio elements with pending network requests. Navigation away doesn't cancel them. |

### MEDIUM

| # | File | Line | Issue |
|---|------|------|-------|
| P3 | `server/src/api/library-config.js` | 71-84 | `fs.readdirSync()` in request handler — blocks event loop on large directories. Use `fs.promises.readdir()`. |
| P4 | `server/src/api/import.js` | 324-388 | N+1 query pattern — 3-5 API calls per album in batch processing. 100 albums = 300-500 requests. |
| P5 | `shared/src/api-client.js` | 221-232 | MusicBrainz prefetch cache never cleaned up — grows indefinitely in long sessions. |
| P6 | `server/src/services/dlna.js` | 104 | Regex compiled on every call via `new RegExp(...)` — should be a precompiled constant. |

---

## 5. Infrastructure

### Docker

| # | File | Issue |
|---|------|-------|
| I1 | `docker-compose.yml` | No resource limits on main `not-ify` service — runaway scan can starve other services. |
| I2 | `docker-compose.yml:38-39` | VPN credentials in env vars — visible via `docker inspect`. Consider Docker secrets. |
| I3 | `docker-compose.yml` | No `depends_on` with health conditions for optional services. |
| I4 | `docker-compose.dev.yml:58` | Ollama `KEEP_ALIVE=300` (5 min) too short — models unloaded during normal usage gaps. |

### CI/CD

| # | File | Issue |
|---|------|-------|
| I5 | `.github/workflows/ci.yml:14` | Node version not pinned — `node-version: 22` is a moving target. Pin to `22.x.x`. |
| I6 | `.github/workflows/ci.yml:13,27,50,70` | GitHub Actions not pinned to commit SHAs — vulnerable to supply-chain attacks. |
| I7 | `.github/workflows/ci.yml:37-42` | E2E health check loop doesn't fail on timeout — tests proceed against dead server. |
| I8 | `.github/workflows/ci.yml:20` | Search tests skipped (`--testPathIgnorePatterns='search.test'`) with no documented reason. |

### Scripts

| # | File | Issue |
|---|------|-------|
| I9 | `scripts/bootstrap.sh:21` | `read -r answer` has no timeout — hung SSH connection blocks setup forever. |
| I10 | `scripts/bootstrap.sh:199-209` | Cleanup trap doesn't remove partial installs after `docker-compose.yml` is written. |

---

## 6. Test Quality

### Coverage Gaps

| Area | Estimated Coverage | Gap |
|------|-------------------|-----|
| Server API routes | ~40% | No security tests (auth bypass, injection), no error recovery tests |
| Server services | ~35% | No graceful shutdown tests, no resource cleanup tests |
| Client components | ~5% | No React component tests at all — only utility function tests |
| Client hooks | ~10% | No interaction tests, no SSE reconnection tests |
| E2E | Basic | Health check + basic flows only — no error path coverage |

### Quality Issues

| # | Issue |
|---|-------|
| T1 | Brittle mock cascade — every test file mocks 15+ services independently. One change breaks many files. Should use shared mock factory. |
| T2 | `cast.test.js:76` uses private IP `192.168.1.50` in test data (also flagged in PII audit). |
| T3 | DB mocks always return success (`isValidUser: jest.fn().mockReturnValue(true)`) — never tests invalid user paths. |
| T4 | No performance or load tests — untested behavior with large libraries (10K+ tracks). |
| T5 | No accessibility tests for client components. |

---

## 7. Code Quality

| # | File | Issue |
|---|------|-------|
| Q1 | `server/src/api/` (multiple) | Inconsistent error response format — some return `{ error }`, others `{ status, error }`, others `{ message }`. |
| Q2 | `server/src/api/import.js:43,207` | Magic numbers (30000ms, 1500ms) — no named constants. |
| Q3 | `server/src/api/youtube.js:22` | Dead code — `const MUSIC_DIR = null; // DEPRECATED`. |
| Q4 | `client/src/components/AlbumView.jsx:11-48` | 40+ props — excessive prop drilling. |
| Q5 | `client/src/` (multiple hooks) | Inconsistent error handling — mix of `.catch(() => {})`, `.catch(err => console.error())`, and try-catch. |
| Q6 | `client/src/` (multiple) | Magic numbers for polling/timeout intervals without named constants (3000, 5000, 10000ms). |
| Q7 | `server/package.json` | Unused dependencies: `node-ssdp`, `upnp-client-ts` — replaced by custom DLNA implementation. |

---

## 8. Unused / Unnecessary

| # | Item | Location | Action |
|---|------|----------|--------|
| U1 | `node-ssdp` dependency | `server/package.json` | Remove |
| U2 | `upnp-client-ts` dependency | `server/package.json` | Remove |
| U3 | `const MUSIC_DIR = null` | `server/src/api/youtube.js:22` | Remove dead code |
| U4 | 20+ `console.log()` in prod code | `library.js`, `pipeline.js`, `container-manager.js`, etc. | Migrate to logger service |

---

## Summary

| Category | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| Security | 8 | 3 | 4 | — | 15 |
| Bugs | 1 | 5 | 7 | — | 13 |
| Error Handling | — | 2 | 6 | — | 8 |
| Performance | — | 2 | 4 | — | 6 |
| Infrastructure | — | — | 10 | — | 10 |
| Tests | — | — | 5 | — | 5 |
| Code Quality | — | — | — | 7 | 7 |
| Unused | — | — | — | 4 | 4 |
| **Total** | **9** | **12** | **36** | **11** | **68** |
