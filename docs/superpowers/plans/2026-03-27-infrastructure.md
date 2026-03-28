# Infrastructure Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden infrastructure: Docker resource limits, CI pinning, script robustness.

**Architecture:** Configuration-only changes — no application code modified.

**Tech Stack:** Docker Compose, GitHub Actions, Bash

---

## File Map

| Task | Create | Modify | Test |
|------|--------|--------|------|
| 1 (I1) | — | `docker-compose.yml` | `docker compose config` validation |
| 2 (I2) | — | `docker-compose.yml` | Visual inspection |
| 3 (I3) | — | `docker-compose.yml` | `docker compose config` validation |
| 4 (I4) | — | `docker-compose.dev.yml` | `docker compose -f docker-compose.yml -f docker-compose.dev.yml config` |
| 5 (I5) | — | `.github/workflows/ci.yml` | CI run on next push |
| 6 (I6) | — | `.github/workflows/ci.yml` | CI run on next push |
| 7 (I7) | — | `.github/workflows/ci.yml` | CI run on next push |
| 8 (I8) | — | `.github/workflows/ci.yml` | Visual inspection |
| 9 (I9) | — | `scripts/bootstrap.sh` | Manual test: `bash -x scripts/bootstrap.sh` |
| 10 (I10) | — | `scripts/bootstrap.sh` | Manual test: interrupt during install |

---

### Task 1: Add resource limits to not-ify service (I1)

**Files:**
- Modify: `docker-compose.yml` (services.not-ify block)

**Context:** The `not-ify` service has no `deploy.resources` section, unlike `clamav` which has `memory: 4G`. A runaway Node process could consume all host RAM on a NAS with limited resources.

- [ ] **Step 1: Add deploy.resources to not-ify service**

In `docker-compose.yml`, after the `healthcheck` block for `not-ify` (after line 27), add:

```yaml
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: '2.0'
        reservations:
          memory: 256M
```

The full `not-ify` service block should now be:

```yaml
  not-ify:
    ports:
      - "${PORT:-3000}:3000"
    volumes:
      - ./music:/app/music
      - ./config:/app/config
    environment:
      - NODE_ENV=${NODE_ENV:-production}
      - CONFIG_DIR=/app/config
      - MUSIC_DIR=/app/music
      - VPN_ENABLED=${VPN_ENABLED:-false}
      - VPN_PROXY=http://gluetun:8888
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: '2.0'
        reservations:
          memory: 256M
```

- [ ] **Step 2: Verify compose config is valid**

Run: `docker compose -f docker-compose.yml config --quiet`
Expected: No errors (exit code 0)

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "infra: add resource limits to not-ify service (I1)"
```

---

### Task 2: Document VPN credential exposure risk (I2)

**Files:**
- Modify: `docker-compose.yml` (gluetun service block)

**Context:** `PIA_USERNAME` and `PIA_PASSWORD` are passed as environment variables. Anyone with Docker socket access can read them via `docker inspect`. Docker secrets would be more secure but require Swarm mode. Document the risk and mitigation path.

- [ ] **Step 1: Add security comment to gluetun environment block**

In `docker-compose.yml`, before line 38 (`- OPENVPN_USER=${PIA_USERNAME}`), add:

```yaml
      # SECURITY NOTE: VPN credentials are visible via `docker inspect`.
      # For production hardening, consider Docker secrets (requires Swarm mode)
      # or mounting a credentials file into the container instead.
      # See: https://github.com/qdm12/gluetun-wiki/blob/main/setup/advanced/docker-secrets.md
```

- [ ] **Step 2: Verify compose config is still valid**

Run: `docker compose -f docker-compose.yml config --quiet`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "docs: document VPN credential exposure risk in docker-compose (I2)"
```

---

### Task 3: Add depends_on with health conditions (I3)

**Files:**
- Modify: `docker-compose.yml` (not-ify service block)

**Context:** The base `docker-compose.yml` has no `depends_on` for not-ify. The dev override has `depends_on` with `condition: service_healthy` for ollama and clamav, but the base has none. When VPN profile is active, not-ify should wait for gluetun to be healthy before starting.

- [ ] **Step 1: Add conditional depends_on for gluetun**

In `docker-compose.yml`, in the `not-ify` service block, after the `deploy.resources` section added in Task 1, add:

```yaml
    depends_on:
      gluetun:
        condition: service_healthy
        required: false
```

The `required: false` key means this dependency only applies when gluetun is actually started (i.e., `--profile vpn` is active). Without it, `docker compose up` without the vpn profile would fail because gluetun isn't running.

- [ ] **Step 2: Verify compose config is valid with and without vpn profile**

Run: `docker compose -f docker-compose.yml config --quiet`
Expected: No errors

Run: `docker compose -f docker-compose.yml --profile vpn config --quiet`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "infra: add depends_on with health condition for gluetun (I3)"
```

---

### Task 4: Increase Ollama KEEP_ALIVE timeout (I4)

**Files:**
- Modify: `docker-compose.dev.yml:58`

**Context:** `OLLAMA_KEEP_ALIVE=300` (5 minutes) means the model is unloaded after 5 minutes of inactivity. Reloading a model takes 10-30 seconds depending on the model size. For a dev environment where the LLM is used intermittently, 1 hour is more appropriate.

- [ ] **Step 1: Change KEEP_ALIVE from 300 to 3600**

In `docker-compose.dev.yml` line 58, change:

```yaml
      - OLLAMA_KEEP_ALIVE=300
```

to:

```yaml
      - OLLAMA_KEEP_ALIVE=3600
```

- [ ] **Step 2: Verify compose config is valid**

Run: `docker compose -f docker-compose.yml -f docker-compose.dev.yml config --quiet`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add docker-compose.dev.yml
git commit -m "infra: increase Ollama KEEP_ALIVE to 1 hour for dev (I4)"
```

---

### Task 5: Pin Node version in CI (I5)

**Files:**
- Modify: `.github/workflows/ci.yml:14` and `:52`

**Context:** `node-version: 22` resolves to whatever the latest 22.x is at build time. A point release could introduce a regression. Pin to a specific minor to ensure reproducible builds.

- [ ] **Step 1: Pin Node version to 22.x in both setup-node steps**

In `.github/workflows/ci.yml` line 16, change:

```yaml
          node-version: 22
```

to:

```yaml
          node-version: '22.14'
```

And line 52 (second `setup-node` step), change:

```yaml
          node-version: 22
```

to:

```yaml
          node-version: '22.14'
```

Note: Using `22.14` (minor) rather than `22.14.0` (patch) — this pins the minor but allows patch updates for security fixes.

- [ ] **Step 2: Verify syntax**

Run: `python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` or manually review the file.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: pin Node.js to 22.14 for reproducible builds (I5)"
```

---

### Task 6: Pin GitHub Actions to commit SHAs (I6)

**Files:**
- Modify: `.github/workflows/ci.yml` (all `uses:` lines)

**Context:** Actions pinned to major version tags (`@v5`, `@v3`) can be updated by the action maintainer at any time. Pinning to commit SHAs prevents supply chain attacks. Add a version comment for readability.

- [ ] **Step 1: Replace all action version tags with SHAs**

Look up the current commit SHAs for each action's version tag and replace. The current actions and their target SHAs (verify these at time of implementation):

In `.github/workflows/ci.yml`, replace all occurrences:

```yaml
      - uses: actions/checkout@v5
```
with (use the actual SHA for actions/checkout@v5 at implementation time):
```yaml
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v5
```

```yaml
      - uses: actions/setup-node@v5
```
with:
```yaml
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020  # v5
```

```yaml
      - uses: docker/login-action@v3
```
with:
```yaml
      - uses: docker/login-action@74a5d142397b4f367a81961eba4e8cd7edddf772  # v3
```

```yaml
      - uses: softprops/action-gh-release@v2
```
with:
```yaml
      - uses: softprops/action-gh-release@da05d552573ad5aba039eaac05058a918a7bf631  # v2
```

**IMPORTANT:** Verify the SHAs at implementation time by running:
```bash
gh api repos/actions/checkout/commits/v5 --jq .sha
gh api repos/actions/setup-node/commits/v5 --jq .sha
gh api repos/docker/login-action/commits/v3 --jq .sha
gh api repos/softprops/action-gh-release/commits/v2 --jq .sha
```

- [ ] **Step 2: Verify syntax**

Run: `cat .github/workflows/ci.yml` and review that all `uses:` lines have SHA + comment.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: pin GitHub Actions to commit SHAs for supply chain safety (I6)"
```

---

### Task 7: Add timeout/failure to E2E health check loop (I7)

**Files:**
- Modify: `.github/workflows/ci.yml:37-42`

**Context:** The health check loop runs `for i in $(seq 1 30)` with `curl` and `sleep 1`, but if all 30 attempts fail, the step exits with code 0 (the last `sleep 1` succeeds). This means a broken image passes the health check step and fails later with a confusing error.

- [ ] **Step 1: Add explicit failure after loop exhaustion**

In `.github/workflows/ci.yml`, replace lines 37-42:

```yaml
      - name: Wait for server
        run: |
          for i in $(seq 1 30); do
            curl -sf http://localhost:3000/api/health && break
            sleep 1
          done
```

with:

```yaml
      - name: Wait for server
        run: |
          for i in $(seq 1 30); do
            curl -sf http://localhost:3000/api/health && exit 0
            sleep 1
          done
          echo "::error::Server health check failed after 30 attempts"
          docker logs not-ify-ci || true
          exit 1
```

Key changes:
- `&& exit 0` instead of `&& break` — exits the step immediately on success
- After the loop: prints an error annotation, dumps container logs for debugging, then exits with code 1

- [ ] **Step 2: Verify syntax**

Review the file manually to confirm YAML indentation is correct.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: fail E2E health check on timeout instead of silently passing (I7)"
```

---

### Task 8: Document skipped search tests (I8)

**Files:**
- Modify: `.github/workflows/ci.yml:19-20`

**Context:** Line 20 skips search tests with `--testPathIgnorePatterns='search.test'` but there is no comment explaining why. The step name says "excluding flaky search tests" but doesn't link to an issue or explain what makes them flaky.

- [ ] **Step 1: Add a comment explaining the skip**

In `.github/workflows/ci.yml`, replace lines 19-20:

```yaml
      - name: Server tests (excluding flaky search tests)
        run: cd packages/server && npx jest --testPathIgnorePatterns='search.test'
```

with:

```yaml
      - name: Server tests (excluding flaky search tests)
        # search.test.js hits live MusicBrainz/SolidTorrents APIs and is rate-limited in CI.
        # These tests run locally during development. See packages/server/__tests__/api/search.test.js.
        run: cd packages/server && npx jest --testPathIgnorePatterns='search.test'
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "docs: explain why search tests are skipped in CI (I8)"
```

---

### Task 9: Add timeout to bootstrap read prompt (I9)

**Files:**
- Modify: `scripts/bootstrap.sh:21`

**Context:** The `ask()` function uses `read -r answer` with no timeout. If the script is run non-interactively (e.g., piped input that closes), it hangs forever. Adding `-t 60` makes it time out after 60 seconds.

- [ ] **Step 1: Add timeout to read command**

In `scripts/bootstrap.sh` line 21, change:

```bash
  read -r answer
```

to:

```bash
  read -r -t 60 answer || { echo "" >&2; info "Timed out waiting for input." >&2; exit 1; }
```

This will:
- Wait up to 60 seconds for input
- On timeout: print a newline (to not mess up the terminal), show a message, and exit cleanly

- [ ] **Step 2: Verify by manual testing**

Run: `echo "" | timeout 5 bash scripts/bootstrap.sh` (on a system with Docker)
Expected: Script should exit cleanly rather than hanging

- [ ] **Step 3: Commit**

```bash
git add scripts/bootstrap.sh
git commit -m "fix: add 60s timeout to bootstrap read prompts (I9)"
```

---

### Task 10: Improve cleanup trap for partial installs (I10)

**Files:**
- Modify: `scripts/bootstrap.sh:199-209`

**Context:** The current cleanup trap only removes `$INSTALL_DIR` if `docker-compose.yml` doesn't exist there. But partial installs could leave behind:
- The `config/` and `slskd/` subdirectories created at line 471
- A pulled Docker image
- A running container from the setup step (line 493-512)

The trap should also stop any containers that were started.

- [ ] **Step 1: Improve the cleanup function**

In `scripts/bootstrap.sh`, replace lines 200-208:

```bash
INSTALL_DIR=""
cleanup() {
  echo ""
  warn "Setup interrupted."
  if [ -n "$INSTALL_DIR" ] && [ -d "$INSTALL_DIR" ] && [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
    warn "Cleaning up partial install at $INSTALL_DIR..."
    rm -rf "$INSTALL_DIR"
  fi
  exit 1
}
```

with:

```bash
INSTALL_DIR=""
cleanup() {
  echo ""
  warn "Setup interrupted."
  # Stop any containers started during setup
  if docker ps --filter name=not-ify --format '{{.Names}}' 2>/dev/null | grep -q 'not-ify'; then
    warn "Stopping containers started during setup..."
    docker stop not-ify 2>/dev/null || true
    docker rm not-ify 2>/dev/null || true
  fi
  # Remove partial install directory (only if compose file wasn't generated yet)
  if [ -n "$INSTALL_DIR" ] && [ -d "$INSTALL_DIR" ] && [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
    warn "Cleaning up partial install at $INSTALL_DIR..."
    rm -rf "$INSTALL_DIR"
  fi
  exit 1
}
```

- [ ] **Step 2: Verify by manual testing**

1. Start bootstrap, wait until after Step 5 (image pull), then press Ctrl+C
2. Verify: `docker ps` shows no not-ify container
3. Verify: partial install directory is removed

- [ ] **Step 3: Commit**

```bash
git add scripts/bootstrap.sh
git commit -m "fix: cleanup trap stops containers and handles partial installs (I10)"
```
