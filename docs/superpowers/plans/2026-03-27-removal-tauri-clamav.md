# Tauri Desktop & ClamAV Removal Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Tauri desktop package and ClamAV integration to reduce complexity.

**Architecture:** Pure deletion — no new code. Verify existing tests pass after each removal step.

**Tech Stack:** npm workspaces, Docker Compose, Jest

---

## File Map

| Task | Delete | Modify | Test |
|------|--------|--------|------|
| 1 | `packages/desktop/` | — | `npm install` succeeds |
| 2 | `.github/workflows/release-desktop.yml` | — | — |
| 3 | — | `package.json:12` | `npm run` lists scripts |
| 4 | — | `.gitignore:19-22` | — |
| 5 | — | `.dockerignore:4` | — |
| 6 | — | `packages/server/src/services/file-validator.js` | `npx jest file-validator.test.js` |
| 7 | — | `packages/server/__tests__/services/file-validator.test.js` | self |
| 8 | — | `packages/server/src/services/container-manager.js:68,99,160` | — |
| 9 | — | `docker-compose.yml:58-82` | `docker compose config` |
| 10 | — | `docker-compose.dev.yml:24-26,30-34` | `docker compose -f docker-compose.yml -f docker-compose.dev.yml config` |
| 11 | — | `scripts/docker-compose.template.yml:24-26,92-104` | — |
| 12 | — | `scripts/setup.sh:16,24,48,147-155,167,221-222` | — |
| 13 | — | `scripts/bootstrap.sh:364,439-448,501,512` | — |
| 14 | — | `packages/server/__tests__/services/job-processor.test.js:32` | `npx jest job-processor.test.js` |
| 15 | — | `packages/server/__tests__/services/pipeline-e2e.test.js:81,233-234,313-328` | `npx jest pipeline-e2e.test.js` |
| 16 | — | `packages/server/__tests__/api/pipeline-validation.test.js:71` | `npx jest pipeline-validation.test.js` |
| 17 | — | `packages/client/src/services/client-diagnostics.js:114` | — |
| 18 | — | `packages/client/src/components/ActivityLog.jsx:86` | — |
| 19 | — | — | Full test suite pass + `npm install` |

---

### Task 1: Delete `packages/desktop/` directory

**Files:**
- Delete: `packages/desktop/` (entire directory)

**Context:** The `packages/desktop/` workspace contains a Tauri 2 app (package.json, src-tauri/, app-icon.png). Removing the directory removes it from the npm workspaces glob `packages/*`.

- [ ] **Step 1: Delete the directory**

```bash
rm -rf packages/desktop
```

- [ ] **Step 2: Verify workspace resolution**

Run: `npm install`
Expected: Succeeds without errors. `package-lock.json` regenerated without `@not-ify/desktop`.

- [ ] **Step 3: Verify no other files reference the desktop package**

```bash
grep -r "not-ify/desktop\|@not-ify/desktop" packages/ --include="*.js" --include="*.jsx" --include="*.json"
```
Expected: No matches (desktop was standalone, no cross-workspace imports).

---

### Task 2: Delete `.github/workflows/release-desktop.yml`

**Files:**
- Delete: `.github/workflows/release-desktop.yml`

- [ ] **Step 1: Delete the workflow file**

```bash
rm .github/workflows/release-desktop.yml
```

- [ ] **Step 2: Verify remaining workflows are unaffected**

```bash
ls .github/workflows/
```
Expected: `ci.yml` and any other workflows remain.

---

### Task 3: Remove `dev:desktop` script from root `package.json`

**Files:**
- Modify: `package.json:12`

**Context:** Line 12 contains `"dev:desktop": "npm run tauri dev -w @not-ify/desktop"`. This references the deleted workspace.

- [ ] **Step 1: Remove the script line**

In `package.json`, remove line 12:
```json
    "dev:desktop": "npm run tauri dev -w @not-ify/desktop",
```

The resulting scripts block should be:
```json
  "scripts": {
    "dev": "docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build",
    "dev:client": "npm run dev -w @not-ify/client",
    "dev:server": "npm run dev -w @not-ify/server",
    "build": "npm run build -w @not-ify/client",
    "build:docker": "docker build -f docker/Dockerfile -t not-ify:latest .",
    "test": "npm run test -w @not-ify/server && npm run test -w @not-ify/client",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:headed": "playwright test --headed",
    "release:patch": "npm version patch && git push --follow-tags",
    "release:minor": "npm version minor && git push --follow-tags",
    "release:major": "npm version major && git push --follow-tags"
  },
```

- [ ] **Step 2: Verify JSON is valid**

```bash
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('valid')"
```

---

### Task 4: Remove desktop lines from `.gitignore`

**Files:**
- Modify: `.gitignore:19-22`

**Context:** Lines 19-22 are Tauri build artifact ignores:
```
# Tauri build artifacts
packages/desktop/src-tauri/target/
packages/desktop/src-tauri/gen/
packages/desktop/src-tauri/Cargo.lock
```

- [ ] **Step 1: Remove the 4 lines (including the comment)**

Delete lines 19-22 from `.gitignore`:
```
# Tauri build artifacts
packages/desktop/src-tauri/target/
packages/desktop/src-tauri/gen/
packages/desktop/src-tauri/Cargo.lock
```

The line before (line 18, `*.log`) should now be followed by line 23 (blank line before `# Temp/scratch files`).

---

### Task 5: Remove desktop reference from `.dockerignore`

**Files:**
- Modify: `.dockerignore:4`

**Context:** Line 4 is `packages/desktop/src-tauri/target`. The directory no longer exists.

- [ ] **Step 1: Remove line 4**

Delete this line from `.dockerignore`:
```
packages/desktop/src-tauri/target
```

The resulting file should be:
```
node_modules
packages/*/node_modules
packages/client/dist
music
config
*.md
.git
.github
e2e
```

---

### Task 6: Remove ClamAV functions from `file-validator.js`

**Files:**
- Modify: `packages/server/src/services/file-validator.js`

**Context:** The file contains ClamAV-specific code:
- Line 6: `const net = require('net');` (only used by ClamAV TCP)
- Line 8: `const CLAM_SOCKET = ...` (unused even before, but ClamAV-related)
- Line 10: `const CLAM_CHUNK_SIZE = ...`
- Lines 20-22: `isClamEnabled()` function
- Lines 74-136: `checkClamAVviaTCP()` function
- Lines 138-161: `checkClamAV()` function
- Lines 200-209: ClamAV branch in `validateFile()` (steps 4)
- Lines 211-218: `_toolStatus` clam tracking
- Lines 227-229: `scanClamAV()` function
- Line 234: `clamdscan` in `getStatus()` return
- Line 240: `scanClamAV` in `module.exports`
- Line 242: `checkClamAV` in `_test` exports

- [ ] **Step 1: Remove `net` import (line 6)**

Remove:
```javascript
const net = require('net');
```

- [ ] **Step 2: Remove ClamAV constants (lines 8, 10)**

Remove:
```javascript
const CLAM_SOCKET = process.env.CLAM_SOCKET || '/var/run/clamav/clamd.sock'; // eslint-disable-line no-unused-vars
```
and:
```javascript
const CLAM_CHUNK_SIZE = 64 * 1024; // 64 KB chunks for INSTREAM
```

- [ ] **Step 3: Remove `isClamEnabled()` (lines 20-22)**

Remove:
```javascript
function isClamEnabled() {
  return process.env.CLAM_ENABLED !== 'false';
}
```

- [ ] **Step 4: Remove `checkClamAVviaTCP()` (lines 74-136)**

Remove the entire function from `function checkClamAVviaTCP(filePath) {` through the closing `}` on line 136.

- [ ] **Step 5: Remove `checkClamAV()` (lines 138-161)**

Remove the entire function from `async function checkClamAV(filePath) {` through the closing `}` on line 161.

- [ ] **Step 6: Remove ClamAV step from `validateFile()` (lines 200-209)**

Remove the entire ClamAV block (step 4 comment + code):
```javascript
  // 4. ClamAV scan — sync for upgrades, deferred for initial downloads
  if (!opts.deferClam) {
    const clamCheck = await checkClamAV(filePath);
    results.checks.push(clamCheck);
    if (!clamCheck.skipped && !clamCheck.passed) {
      results.passed = false;
    }
  } else {
    results.checks.push({ name: 'clam', skipped: true, detail: 'deferred (async)' });
  }
```

- [ ] **Step 7: Remove clam from `_toolStatus` tracking (lines 211-218)**

Change:
```javascript
  const _mime = results.checks.find(c => c.name === 'mime');
  const _ffprobe = results.checks.find(c => c.name === 'ffprobe');
  const _clam = results.checks.find(c => c.name === 'clam');
  _toolStatus = {
    file: _mime ? !_mime.skipped : null,
    ffprobe: _ffprobe ? !_ffprobe.skipped : null,
    clamdscan: _clam ? !_clam.skipped : null,
  };
```
to:
```javascript
  const _mime = results.checks.find(c => c.name === 'mime');
  const _ffprobe = results.checks.find(c => c.name === 'ffprobe');
  _toolStatus = {
    file: _mime ? !_mime.skipped : null,
    ffprobe: _ffprobe ? !_ffprobe.skipped : null,
  };
```

- [ ] **Step 8: Remove `scanClamAV()` function (lines 227-229)**

Remove:
```javascript
/**
 * Run ClamAV scan independently. Use after validateFile({ deferClam: true }).
 * Returns the clam check result. If the file fails, caller should remove it.
 */
async function scanClamAV(filePath) {
  return checkClamAV(filePath);
}
```

- [ ] **Step 9: Remove `deferClam` from JSDoc on `validateFile`**

Change the JSDoc (lines 163-171):
```javascript
/**
 * Validate a downloaded audio file.
 * @param {string} filePath — path to the file
 * @param {object} [opts]
 * @param {boolean} [opts.deferClam=false] — if true, skip ClamAV in this call
 *   (caller is responsible for running scanClamAV() async afterward).
 *   Use for initial downloads where streaming speed matters.
 *   Always run sync (deferClam=false) for upgrades that replace existing files.
 */
```
to:
```javascript
/**
 * Validate a downloaded audio file.
 * @param {string} filePath — path to the file
 */
```

- [ ] **Step 10: Update `getStatus()` return value (line 234)**

Change:
```javascript
    tools: _toolStatus || { file: 'untested', ffprobe: 'untested', clamdscan: 'untested' },
```
to:
```javascript
    tools: _toolStatus || { file: 'untested', ffprobe: 'untested' },
```

- [ ] **Step 11: Update `module.exports`**

Change:
```javascript
module.exports = {
  validateFile,
  scanClamAV,
  getStatus,
  _test: { checkMimeType, checkFfprobe, checkFileSize, checkClamAV },
};
```
to:
```javascript
module.exports = {
  validateFile,
  getStatus,
  _test: { checkMimeType, checkFfprobe, checkFileSize },
};
```

- [ ] **Step 12: Verify**

Run: `cd packages/server && npx jest __tests__/services/file-validator.test.js --no-cache`
Expected: Tests that don't depend on ClamAV pass. ClamAV-specific tests will fail (removed in Task 7).

---

### Task 7: Remove ClamAV tests from `file-validator.test.js`

**Files:**
- Modify: `packages/server/__tests__/services/file-validator.test.js`

**Context:** The test file has ClamAV-related code in:
- Lines 16-17: `afterEach` cleanup of `CLAM_ENABLED` env var
- Lines 21, 32-37: `clamResult` parameter in `mockExecSync` and its `clamdscan` branch
- Lines 47, 79, 95, 111, 143, 145, 173, 175, 189: `process.env.CLAM_ENABLED = 'false'` in every test
- Lines 109-139: entire `ClamAV behaviour` describe block

- [ ] **Step 1: Remove `CLAM_ENABLED` from afterEach**

In the `afterEach` block (line 14-18), remove line 16:
```javascript
  delete process.env.CLAM_ENABLED;
```

- [ ] **Step 2: Remove `clamResult` from `mockExecSync`**

Change the `mockExecSync` function (lines 21-38) to remove the clamav branch:
```javascript
function mockExecSync({ mime = 'audio/mpeg\n', ffprobe } = {}) {
  const ffprobeOut = ffprobe !== undefined ? ffprobe : VALID_FFPROBE_OUTPUT;
  jest.spyOn(childProcess, 'execSync').mockImplementation((cmd) => {
    if (cmd.includes('file --mime-type')) {
      if (mime instanceof Error) throw mime;
      return Buffer.from(mime);
    }
    if (cmd.includes('ffprobe')) {
      if (ffprobeOut instanceof Error) throw ffprobeOut;
      return Buffer.from(ffprobeOut);
    }
    return Buffer.from('');
  });
}
```

- [ ] **Step 3: Remove all `process.env.CLAM_ENABLED = 'false'` lines**

Remove `process.env.CLAM_ENABLED = 'false';` from every test that sets it (lines 47, 79, 95, 111, 143, 145, 173, 175, 189).

- [ ] **Step 4: Remove the entire `ClamAV behaviour` describe block (lines 109-139)**

Delete:
```javascript
  describe('ClamAV behaviour', () => {
    it('skips ClamAV when CLAM_ENABLED=false', async () => {
      ...
    });

    it('rejects file flagged by ClamAV', async () => {
      ...
    });
  });
```

- [ ] **Step 5: Verify**

Run: `cd packages/server && npx jest __tests__/services/file-validator.test.js --no-cache`
Expected: All remaining tests PASS.

---

### Task 8: Remove 'clamav' from container-manager.js allowlists

**Files:**
- Modify: `packages/server/src/services/container-manager.js:68,99,160`

**Context:** Three arrays reference `'clamav'`:
- Line 68: `const ALLOWED = ['slskd', 'gluetun', 'clamav', 'not-ify', 'watchtower'];` (restartContainer)
- Line 99: `const ALLOWED = ['slskd', 'gluetun', 'clamav'];` (recreateContainer)
- Line 160: `const names = ['not-ify', 'slskd', 'gluetun', 'clamav', 'watchtower'];` (getAllContainerStatus)

- [ ] **Step 1: Remove 'clamav' from restartContainer allowlist (line 68)**

Change:
```javascript
  const ALLOWED = ['slskd', 'gluetun', 'clamav', 'not-ify', 'watchtower'];
```
to:
```javascript
  const ALLOWED = ['slskd', 'gluetun', 'not-ify', 'watchtower'];
```

- [ ] **Step 2: Remove 'clamav' from recreateContainer allowlist (line 99)**

Change:
```javascript
  const ALLOWED = ['slskd', 'gluetun', 'clamav'];
```
to:
```javascript
  const ALLOWED = ['slskd', 'gluetun'];
```

- [ ] **Step 3: Remove 'clamav' from getAllContainerStatus names (line 160)**

Change:
```javascript
  const names = ['not-ify', 'slskd', 'gluetun', 'clamav', 'watchtower'];
```
to:
```javascript
  const names = ['not-ify', 'slskd', 'gluetun', 'watchtower'];
```

---

### Task 9: Remove ClamAV service from `docker-compose.yml`

**Files:**
- Modify: `docker-compose.yml:58-82`

**Context:** Lines 58-77 define the clamav service block. Lines 80-81 define the `clamav-db` volume.

- [ ] **Step 1: Remove the clamav service block (lines 58-77)**

Delete:
```yaml
  clamav:
    image: clamav/clamav:stable
    volumes:
      - clamav-db:/var/lib/clamav
      - ${MUSIC_DIR:-./music}:/scan:ro
    deploy:
      resources:
        limits:
          memory: 4G
    environment:
      - CLAMD_CONF_MaxFileSize=500M
      - CLAMD_CONF_MaxScanSize=500M
    healthcheck:
      test: ["CMD", "clamdscan", "--ping", "1"]
      interval: 60s
      timeout: 10s
      retries: 5
      start_period: 120s
    profiles:
      - security
```

- [ ] **Step 2: Remove `clamav-db` from volumes (line 81)**

Change the volumes section from:
```yaml
volumes:
  gluetun-data:
  clamav-db:
```
to:
```yaml
volumes:
  gluetun-data:
```

- [ ] **Step 3: Verify compose file is valid**

```bash
docker compose -f docker-compose.yml config > /dev/null 2>&1 && echo "valid" || echo "invalid"
```

---

### Task 10: Remove ClamAV references from `docker-compose.dev.yml`

**Files:**
- Modify: `docker-compose.dev.yml:24-26,30-34`

**Context:**
- Lines 24-26: CLAM env vars in not-ify service environment
- Lines 30-31: clamav dependency in not-ify depends_on
- Lines 33-34: clamav profile override block

- [ ] **Step 1: Remove CLAM env vars from not-ify environment (lines 24-26)**

Delete these three lines from the not-ify service environment:
```yaml
      - CLAM_ENABLED=true
      - CLAM_HOST=clamav
      - CLAM_PORT=3310
```

- [ ] **Step 2: Remove clamav dependency (lines 30-31)**

Delete these lines from the not-ify depends_on:
```yaml
      clamav:
        condition: service_healthy
```

- [ ] **Step 3: Remove clamav profile override block (lines 33-34)**

Delete:
```yaml
  clamav:
    profiles: []  # override security profile to always-on in dev
```

- [ ] **Step 4: Verify compose file is valid**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml config > /dev/null 2>&1 && echo "valid" || echo "invalid"
```

---

### Task 11: Remove ClamAV from `scripts/docker-compose.template.yml`

**Files:**
- Modify: `scripts/docker-compose.template.yml:24-26,92-104`

**Context:**
- Lines 24-26: CLAM env vars in not-ify service
- Lines 92-104: `#CLAM#` commented clamav service block

- [ ] **Step 1: Remove CLAM env vars from not-ify environment (lines 24-26)**

Delete:
```yaml
      - CLAM_ENABLED=${CLAM_ENABLED:-false}
      - CLAM_HOST=${CLAM_HOST:-}
      - CLAM_PORT=${CLAM_PORT:-3310}
```

- [ ] **Step 2: Remove the entire `#CLAM#` block (lines 92-104)**

Delete:
```yaml
#CLAM#  clamav:
#CLAM#    image: clamav/clamav:stable
#CLAM#    container_name: clamav
#CLAM#    restart: unless-stopped
#CLAM#    network_mode: host
#CLAM#    healthcheck:
#CLAM#      test: ["CMD", "clamdcheck"]
#CLAM#      interval: 60s
#CLAM#      timeout: 10s
#CLAM#      retries: 3
#CLAM#      start_period: 120s
#CLAM#    labels:
#CLAM#      - com.centurylinklabs.watchtower.scope=not-ify
```

---

### Task 12: Remove ClamAV from `scripts/setup.sh`

**Files:**
- Modify: `scripts/setup.sh`

**Context:** ClamAV references:
- Line 16: `ENABLE_CLAMAV="n"` in variable initialization
- Line 24: `--clamav=*` argument parsing
- Line 48: `ENABLE_CLAMAV` env var fallback
- Lines 147-155: ClamAV .env writing block
- Line 167: `CONTAINERS` conditional for clamav
- Lines 221-222: clamav startup hint in health check loop

- [ ] **Step 1: Remove `ENABLE_CLAMAV="n"` from variable init (line 16)**

Change:
```bash
INSTALL_DIR="" MUSIC_DIR="" PORT="" API_KEY="" ENABLE_VPN="n" ENABLE_CLAMAV="n"
```
to:
```bash
INSTALL_DIR="" MUSIC_DIR="" PORT="" API_KEY="" ENABLE_VPN="n"
```

- [ ] **Step 2: Remove `--clamav` argument parsing (line 24)**

Delete:
```bash
    --clamav=*)      ENABLE_CLAMAV="${arg#*=}" ;;
```

- [ ] **Step 3: Remove `ENABLE_CLAMAV` env var fallback (line 48)**

Delete:
```bash
ENABLE_CLAMAV="${ENABLE_CLAMAV:-${NOTIFY_ENABLE_CLAMAV:-n}}"
```

- [ ] **Step 4: Remove ClamAV .env block (lines 147-155)**

Delete:
```bash
# Enable ClamAV if requested
if [ "$ENABLE_CLAMAV" = "y" ]; then
  sed -i 's/^#CLAM#//' "${HOST_INSTALL}/docker-compose.yml"
  cat >> "${HOST_INSTALL}/.env" << EOF
CLAM_ENABLED=true
CLAM_HOST=localhost
CLAM_PORT=3310
EOF
fi
```

- [ ] **Step 5: Remove clamav from container list (line 167)**

Delete:
```bash
[ "$ENABLE_CLAMAV" = "y" ] && CONTAINERS="$CONTAINERS clamav"
```

- [ ] **Step 6: Remove clamav startup hint (line 221-222)**

Delete:
```bash
    [ "$container" = "clamav" ] && hint=" (usually 2-3 min)"
```

---

### Task 13: Remove ClamAV from `scripts/bootstrap.sh`

**Files:**
- Modify: `scripts/bootstrap.sh`

**Context:** ClamAV references:
- Line 364: `ENABLE_CLAMAV="n"` initialization
- Lines 439-448: ClamAV prompt section (echo + confirm + success)
- Line 501: `-e NOTIFY_ENABLE_CLAMAV="$ENABLE_CLAMAV"` in docker run
- Line 512: `--clamav="$ENABLE_CLAMAV"` in docker run args

- [ ] **Step 1: Remove `ENABLE_CLAMAV="n"` (line 364)**

Delete:
```bash
ENABLE_CLAMAV="n"
```

- [ ] **Step 2: Remove the ClamAV prompt section (lines 439-448)**

Delete:
```bash
echo -e "  ${BOLD}ClamAV (Antivirus)${NC}"
echo -e "  ${DIM}Scans downloaded files for malware before adding${NC}"
echo -e "  ${DIM}to your library. Recommended for Soulseek downloads.${NC}"
echo -e "  ${DIM}Note: Uses ~200MB RAM and takes 2-3 min to start.${NC}"
if confirm "Enable ClamAV?"; then
  ENABLE_CLAMAV="y"
  success "ClamAV will be installed"
else
  info "Skipped — files are validated by format and ffprobe"
fi
echo ""
```

- [ ] **Step 3: Remove `NOTIFY_ENABLE_CLAMAV` env var from docker run (line 501)**

Delete:
```bash
  -e NOTIFY_ENABLE_CLAMAV="$ENABLE_CLAMAV" \
```

- [ ] **Step 4: Remove `--clamav` arg from docker run (line 512)**

Delete:
```bash
    --clamav="$ENABLE_CLAMAV"
```

Note: after removing `--clamav="$ENABLE_CLAMAV"` (the last arg), ensure the previous line `--vpn="$ENABLE_VPN"` does NOT have a trailing backslash, since it becomes the last argument.

---

### Task 14: Remove `scanClamAV` mock from `job-processor.test.js`

**Files:**
- Modify: `packages/server/__tests__/services/job-processor.test.js:32`

**Context:** Line 32 mocks `scanClamAV` which no longer exists in file-validator exports.

- [ ] **Step 1: Remove `scanClamAV` from the mock**

Change:
```javascript
jest.mock('../../src/services/file-validator', () => ({
  validateFile: (...a) => mockValidateFile(...a),
  scanClamAV: jest.fn().mockResolvedValue({ name: 'clam', passed: true, detail: 'clean' }),
}));
```
to:
```javascript
jest.mock('../../src/services/file-validator', () => ({
  validateFile: (...a) => mockValidateFile(...a),
}));
```

- [ ] **Step 2: Verify**

Run: `cd packages/server && npx jest __tests__/services/job-processor.test.js --no-cache`
Expected: All tests PASS.

---

### Task 15: Remove ClamAV assertions from `pipeline-e2e.test.js`

**Files:**
- Modify: `packages/server/__tests__/services/pipeline-e2e.test.js`

**Context:**
- Line 81: `process.env.CLAM_ENABLED = 'false';` in `setupTestEnv()`
- Lines 233-234: clamCheck assertion in "download -> validate" test
- Lines 313-328: entire "ClamAV deferred scan" test

- [ ] **Step 1: Remove `CLAM_ENABLED` from setupTestEnv (line 81)**

Delete:
```javascript
  process.env.CLAM_ENABLED = 'false';
```

- [ ] **Step 2: Remove clamCheck assertion (lines 233-234)**

In the "download -> validate -> library sync" test, remove:
```javascript
      // ClamAV should be deferred
      const clamCheck = result.checks.find(c => c.name === 'clam');
      expect(clamCheck.skipped).toBe(true);
```

- [ ] **Step 3: Remove the entire "ClamAV deferred scan" test (lines 313-328)**

Delete:
```javascript
  test('ClamAV deferred scan runs async and removes infected file', async () => {
    // Create a file in the library
    const quarantineDir = path.join(musicDir, 'Quarantine_Artist', 'Quarantine_Album');
    fs.mkdirSync(quarantineDir, { recursive: true });
    const filePath = path.join(quarantineDir, 'infected.flac');
    createFakeAudioFile(filePath);
    expect(fs.existsSync(filePath)).toBe(true);

    // Simulate ClamAV scan returning infected
    const fileValidator = require('../../src/services/file-validator');
    // scanClamAV delegates to checkClamAV which is disabled in test env (CLAM_ENABLED=false)
    // So we verify the scan returns skipped in test env
    const result = await fileValidator.scanClamAV(filePath);
    // In test env with CLAM_ENABLED=false, scan is skipped
    expect(result.skipped).toBe(true);
  });
```

- [ ] **Step 4: Verify**

Run: `cd packages/server && npx jest __tests__/services/pipeline-e2e.test.js --no-cache`
Expected: All remaining tests PASS.

---

### Task 16: Remove `scanClamAV` mock from `pipeline-validation.test.js`

**Files:**
- Modify: `packages/server/__tests__/api/pipeline-validation.test.js:71`

**Context:** Line 71 mocks `scanClamAV` which no longer exists.

- [ ] **Step 1: Remove `scanClamAV` from the mock**

Change:
```javascript
jest.mock('../../src/services/file-validator', () => ({
  validateFile: mockValidateFile,
  scanClamAV: jest.fn().mockResolvedValue({ name: 'clam', passed: true, detail: 'clean' }),
}));
```
to:
```javascript
jest.mock('../../src/services/file-validator', () => ({
  validateFile: mockValidateFile,
}));
```

- [ ] **Step 2: Verify**

Run: `cd packages/server && npx jest __tests__/api/pipeline-validation.test.js --no-cache`
Expected: All tests PASS.

---

### Task 17: Remove `clamdscan` from client diagnostics

**Files:**
- Modify: `packages/client/src/services/client-diagnostics.js:114`

**Context:** Line 114 includes `clamdscan` in the diagnostics text output.

- [ ] **Step 1: Remove clamdscan from diagnostics line**

Change:
```javascript
    lines.push(`file-validator: file ${fmt(t.file)} | ffprobe ${fmt(t.ffprobe)} | clamdscan ${fmt(t.clamdscan)}`);
```
to:
```javascript
    lines.push(`file-validator: file ${fmt(t.file)} | ffprobe ${fmt(t.ffprobe)}`);
```

---

### Task 18: Remove `clam` display from `ActivityLog.jsx`

**Files:**
- Modify: `packages/client/src/components/ActivityLog.jsx:86`

**Context:** Line 86 displays clam status in the file-validator service row.

- [ ] **Step 1: Remove clam from the detail string**

Change:
```javascript
    rows.push({ name: 'file-validator', color: f.toolsProbed ? green : yellow, detail: `file: ${fmt(t.file)} | ffprobe: ${fmt(t.ffprobe)} | clam: ${fmt(t.clamdscan)}` });
```
to:
```javascript
    rows.push({ name: 'file-validator', color: f.toolsProbed ? green : yellow, detail: `file: ${fmt(t.file)} | ffprobe: ${fmt(t.ffprobe)}` });
```

---

### Task 19: Final verification — regenerate lockfile and run full tests

- [ ] **Step 1: Regenerate lockfile**

```bash
npm install
```
Expected: Succeeds. `package-lock.json` updated without desktop workspace.

- [ ] **Step 2: Run server tests**

```bash
cd packages/server && npx jest --no-cache
```
Expected: All tests PASS.

- [ ] **Step 3: Run client build**

```bash
npm run build
```
Expected: Succeeds without ClamAV reference errors.

- [ ] **Step 4: Verify no stale ClamAV references remain**

```bash
grep -ri "clamav\|clam_\|clamdscan\|scanClamAV\|checkClamAV\|isClamEnabled\|CLAM_" \
  --include="*.js" --include="*.jsx" --include="*.json" --include="*.yml" --include="*.sh" \
  packages/ scripts/ docker-compose*.yml .github/ .dockerignore .gitignore package.json \
  | grep -v node_modules | grep -v package-lock
```
Expected: No matches.

- [ ] **Step 5: Verify no stale desktop/tauri references remain**

```bash
grep -ri "desktop\|tauri" \
  --include="*.js" --include="*.jsx" --include="*.json" --include="*.yml" --include="*.sh" \
  packages/ scripts/ .github/ .dockerignore .gitignore package.json \
  | grep -v node_modules | grep -v package-lock
```
Expected: No matches related to the desktop app or Tauri.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove Tauri desktop app and ClamAV integration

Removes packages/desktop (Tauri 2 app) and all ClamAV antivirus
scanning code. Both added unnecessary complexity for a home LAN
music server. File validation still checks size, MIME type, and
ffprobe audio parsing."
```
