# SSH Setup Script Implementation Plan (v1.6.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single `docker run` command that installs and configures not-ify on any Linux system with Docker. Handles platform detection, music folder selection, compose generation, container startup, health checks, and prints the web UI URL. Also handles updates for existing installations.

**Architecture:** A bash script (`/app/scripts/setup.sh`) bundled inside the Docker image, triggered by `docker run ... setup`. The setup container mounts the Docker socket (to manage host containers) and the host filesystem read-only (to detect storage). A docker-compose template is rendered with user-selected paths and generated keys. An entrypoint script routes between setup mode and normal server mode.

**Tech Stack:** Bash, Docker CLI + Compose plugin, whiptail (TUI), jq, curl

**Spec:** `docs/superpowers/specs/2026-03-23-one-command-setup-design.md` (Part 1 + Docker Image Changes + Prerequisites + Implementation Notes)

---

## File Structure

### New files
- `scripts/setup.sh` — main setup script (~400 lines)
- `scripts/setup-lib.sh` — reusable functions (platform detect, storage scan, folder browse, health check)
- `scripts/docker-compose.template.yml` — compose template with variable placeholders
- `scripts/entrypoint.sh` — Docker entrypoint that routes setup vs server

### Modified files
- `docker/Dockerfile` — add bash, whiptail, docker CLI, jq, compose plugin; copy scripts; change entrypoint

---

## Phase 1: Docker Image Changes

### Task 1: Update Dockerfile with setup dependencies and entrypoint

**Files:**
- Modify: `docker/Dockerfile`
- Create: `scripts/entrypoint.sh`

- [ ] **Step 1: Create entrypoint.sh**

Create `scripts/entrypoint.sh`:

```bash
#!/bin/bash
if [ "$1" = "setup" ]; then
  shift
  exec /app/scripts/setup.sh "$@"
else
  exec node packages/server/src/index.js "$@"
fi
```

```bash
chmod +x scripts/entrypoint.sh
```

- [ ] **Step 2: Update Dockerfile**

In `docker/Dockerfile`, Stage 2 (production image), add setup dependencies and change the entrypoint:

```dockerfile
# After the existing apt-get install line, add:
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash whiptail jq \
    && rm -rf /var/lib/apt/lists/*

# Install Docker CLI + Compose plugin (for managing host containers during setup)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

# Copy setup scripts
COPY scripts/entrypoint.sh /app/scripts/entrypoint.sh
COPY scripts/setup.sh /app/scripts/setup.sh
COPY scripts/setup-lib.sh /app/scripts/setup-lib.sh
COPY scripts/docker-compose.template.yml /app/scripts/docker-compose.template.yml
RUN chmod +x /app/scripts/*.sh

# Replace CMD with ENTRYPOINT
ENTRYPOINT ["/app/scripts/entrypoint.sh"]
CMD ["server"]
```

Note: Merge the new `apt-get install` into the existing one to keep layers minimal. The Docker CLI + Compose plugin install is a separate layer due to the GPG key setup.

- [ ] **Step 3: Verify Dockerfile builds**

```bash
docker build -f docker/Dockerfile -t not-ify-test .
docker run --rm not-ify-test -- node -e "console.log('server mode works')"
docker run --rm not-ify-test setup --help 2>&1 | head -5
```

- [ ] **Step 4: Commit**

```bash
git add docker/Dockerfile scripts/entrypoint.sh
git commit -m "feat(docker): add setup entrypoint with bash, whiptail, docker CLI, compose plugin"
```

---

## Phase 2: Setup Library Functions

### Task 2: Create setup-lib.sh with reusable functions

**Files:**
- Create: `scripts/setup-lib.sh`

- [ ] **Step 1: Implement setup-lib.sh**

```bash
#!/bin/bash
# setup-lib.sh — Reusable functions for the not-ify setup script

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Print helpers
info()    { echo -e "${CYAN}ℹ${NC}  $*"; }
success() { echo -e "${GREEN}✅${NC} $*"; }
warn()    { echo -e "${YELLOW}⚠️${NC}  $*"; }
error()   { echo -e "${RED}❌${NC} $*"; }
header()  { echo -e "\n${BOLD}$*${NC}\n"; }

# Detect platform from /host/proc/mounts
detect_platform() {
  if grep -q '/share/CACHEDEV' /host/proc/mounts 2>/dev/null; then
    echo "qnap"
  elif grep -q '/volume[0-9]' /host/proc/mounts 2>/dev/null; then
    echo "synology"
  else
    echo "linux"
  fi
}

# Get default install directory for platform
default_install_dir() {
  local platform="$1"
  case "$platform" in
    qnap)    echo "/share/CACHEDEV1_DATA/not-ify" ;;
    synology) echo "/volume1/docker/not-ify" ;;
    linux)   echo "/opt/not-ify" ;;
  esac
}

# Scan host for data storage volumes
# Returns: path|fstype|free_gb (one per line)
scan_storage() {
  # Read host mounts, filter for data filesystems
  grep -E '\s(ext[234]|btrfs|xfs|ntfs|vfat)\s' /host/proc/mounts 2>/dev/null | \
    awk '{print $2}' | \
    grep -v -E '^/(proc|sys|dev|run|tmp|boot|host)' | \
    sort -u | \
    while read -r mount; do
      # Map container path to host path (remove /host prefix for display)
      local host_path="${mount#/host}"
      # Get free space
      local free_kb=$(df -k "/host${host_path}" 2>/dev/null | tail -1 | awk '{print $4}')
      if [ -n "$free_kb" ] && [ "$free_kb" -gt 1048576 ]; then  # > 1GB
        local free_gb=$((free_kb / 1048576))
        local fstype=$(grep " ${mount} " /host/proc/mounts | awk '{print $3}')
        echo "${host_path}|${fstype}|${free_gb}"
      fi
    done
}

# Interactive folder browser using whiptail or numbered menu
browse_folders() {
  local start_dir="${1:-/}"
  local current="/host${start_dir}"

  while true; do
    local display_dir="${current#/host}"
    [ -z "$display_dir" ] && display_dir="/"

    # List subdirectories
    local dirs=()
    local i=0
    while IFS= read -r d; do
      [ -n "$d" ] && dirs+=("$d") && i=$((i+1))
    done < <(ls -1d "${current}"/*/ 2>/dev/null | sed "s|${current}/||" | sed 's|/$||' | head -20)

    echo ""
    echo -e "${BOLD}📁 ${display_dir}${NC}"
    echo ""

    if [ ${#dirs[@]} -eq 0 ]; then
      echo "  (no subdirectories)"
    else
      for j in "${!dirs[@]}"; do
        echo "  [$((j+1))] ${dirs[$j]}"
      done
    fi

    echo ""
    echo "  [S] Select this folder"
    echo "  [N] Create new folder here"
    echo "  [U] Go up"
    echo "  [Q] Cancel"
    echo ""
    read -p "  Choice: " choice

    case "$choice" in
      [sS]) echo "${display_dir}"; return 0 ;;
      [nN])
        read -p "  New folder name: " new_name
        if [ -n "$new_name" ]; then
          mkdir -p "/host${display_dir}/${new_name}" 2>/dev/null
          if [ $? -eq 0 ]; then
            echo "${display_dir}/${new_name}"
            return 0
          else
            error "Failed to create folder"
          fi
        fi
        ;;
      [uU]) current=$(dirname "$current") ;;
      [qQ]) return 1 ;;
      [0-9]*)
        local idx=$((choice - 1))
        if [ $idx -ge 0 ] && [ $idx -lt ${#dirs[@]} ]; then
          current="${current}/${dirs[$idx]}"
        fi
        ;;
    esac
  done
}

# Check if a port is in use (via Docker or host)
check_port() {
  local port="$1"
  # Check Docker containers
  local container=$(docker ps --format '{{.Names}}' --filter "publish=${port}" 2>/dev/null | head -1)
  if [ -n "$container" ]; then
    echo "$container"
    return 0
  fi
  # Check host /proc/net/tcp (port in hex)
  local hex_port=$(printf '%04X' "$port")
  if grep -qi ":${hex_port} " /host/proc/net/tcp 2>/dev/null; then
    echo "unknown process"
    return 0
  fi
  return 1
}

# Wait for a container to become healthy
wait_healthy() {
  local container="$1"
  local timeout="${2:-60}"
  local elapsed=0

  while [ $elapsed -lt $timeout ]; do
    local status=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null)
    case "$status" in
      healthy) return 0 ;;
      unhealthy) return 1 ;;
    esac
    # No health check defined — just check if running
    local running=$(docker inspect --format='{{.State.Running}}' "$container" 2>/dev/null)
    if [ "$running" = "true" ] && [ -z "$status" ]; then
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
    echo -ne "\r  ⏳ ${container} (${elapsed}s)..."
  done
  return 1
}

# Detect host LAN IP
detect_host_ip() {
  # Method 1: Docker API
  local ip=$(curl -s --unix-socket /var/run/docker.sock http://localhost/info 2>/dev/null | jq -r '.Swarm.NodeAddr // empty')
  if [ -n "$ip" ] && [ "$ip" != "null" ] && [ "$ip" != "0.0.0.0" ]; then
    echo "$ip"; return
  fi

  # Method 2: Parse host route table
  local iface=$(cat /host/proc/net/route 2>/dev/null | awk '$2 == "00000000" {print $1; exit}')
  if [ -n "$iface" ]; then
    ip=$(cat /host/proc/net/fib_trie 2>/dev/null | grep -A1 "/$iface" | grep -oP '\d+\.\d+\.\d+\.\d+' | head -1)
    if [ -n "$ip" ]; then echo "$ip"; return; fi
  fi

  # Method 3: Fallback
  ip=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K[\d.]+')
  if [ -n "$ip" ]; then echo "$ip"; return; fi

  echo "localhost"
}

# Generate a UUID (for API keys)
generate_uuid() {
  cat /proc/sys/kernel/random/uuid 2>/dev/null || head -c 32 /dev/urandom | xxd -p
}

# Get version from package.json inside the setup container
get_bundled_version() {
  node -e "console.log(require('/app/package.json').version)" 2>/dev/null || echo "unknown"
}

# Get running version from a not-ify instance
get_running_version() {
  local port="$1"
  curl -s --connect-timeout 3 "http://localhost:${port}/api/health" 2>/dev/null | jq -r '.version // empty'
}

# Check if Docker Compose v2 is available
check_compose() {
  if docker compose version &>/dev/null; then
    echo "v2"
  elif docker-compose --version &>/dev/null; then
    echo "v1"
  else
    echo "none"
  fi
}
```

- [ ] **Step 2: Commit**

```bash
chmod +x scripts/setup-lib.sh
git add scripts/setup-lib.sh
git commit -m "feat(setup): add setup-lib.sh — platform detect, storage scan, folder browse, health check"
```

---

### Task 3: Create docker-compose template

**Files:**
- Create: `scripts/docker-compose.template.yml`

- [ ] **Step 1: Create template**

The template uses `${VARIABLE}` placeholders that docker compose resolves from `.env` + `.env.local`:

```yaml
version: '3.8'

services:
  not-ify:
    image: ghcr.io/illtrick/not-ify:latest
    container_name: not-ify
    restart: unless-stopped
    network_mode: host
    volumes:
      - ${CONFIG_DIR}:/app/config
      - ${MUSIC_DIR}:/app/music
      - ${SLSKD_DOWNLOADS_DIR:-./slskd-downloads}:/app/slskd-downloads
    environment:
      - NODE_ENV=${NODE_ENV:-production}
      - PORT=${PORT:-3000}
      - CONFIG_DIR=/app/config
      - MUSIC_DIR=/app/music
      - LOG_LEVEL=${LOG_LEVEL:-info}
      - DLNA_ENABLED=${DLNA_ENABLED:-true}
      - SLSKD_URL=http://localhost:5030
      - SLSKD_API_KEY=${SLSKD_API_KEY}
      - SLSKD_DOWNLOADS_DIR=/app/slskd-downloads
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:${PORT:-3000}/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s

  slskd:
    image: slskd/slskd:latest
    container_name: slskd
    restart: unless-stopped
    network_mode: host
    volumes:
      - ./slskd:/app
      - ${SLSKD_DOWNLOADS_DIR:-./slskd-downloads}:/app/downloads
      - ${MUSIC_DIR}:/music:ro
    environment:
      - SLSKD_HTTP_PORT=5030
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5030/api/v0/application"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s

  watchtower:
    image: containrrr/watchtower
    container_name: watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - WATCHTOWER_CLEANUP=true
      - WATCHTOWER_POLL_INTERVAL=300
      - WATCHTOWER_SCOPE=not-ify
    labels:
      - com.centurylinklabs.watchtower.scope=not-ify
    command: --scope not-ify

# Uncomment to enable VPN (configure in Settings after setup):
#  gluetun:
#    image: qmcgaw/gluetun
#    container_name: gluetun
#    restart: unless-stopped
#    cap_add:
#      - NET_ADMIN
#    environment:
#      - VPN_SERVICE_PROVIDER=private_internet_access
#      - OPENVPN_USER=${VPN_USERNAME}
#      - OPENVPN_PASSWORD=${VPN_PASSWORD}
#      - SERVER_REGIONS=${VPN_REGION:-US East}
#    ports:
#      - "8888:8888"
#      - "8000:8000/tcp"
```

- [ ] **Step 2: Commit**

```bash
git add scripts/docker-compose.template.yml
git commit -m "feat(setup): add docker-compose template for generated deployments"
```

---

## Phase 3: Main Setup Script

### Task 4: Create setup.sh — fresh install flow

**Files:**
- Create: `scripts/setup.sh`

- [ ] **Step 1: Implement setup.sh**

```bash
#!/bin/bash
set -e

# Source library functions
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/setup-lib.sh"

# ═══════════════════════════════════════════════
#  Not-ify Setup
# ═══════════════════════════════════════════════

clear
echo ""
echo -e "${BOLD}  ╔══════════════════════════════════╗${NC}"
echo -e "${BOLD}  ║        ${RED}Not-ify${NC}${BOLD} Setup             ║${NC}"
echo -e "${BOLD}  ╚══════════════════════════════════╝${NC}"
echo ""

BUNDLED_VERSION=$(get_bundled_version)
info "Setup version: ${BUNDLED_VERSION}"
echo ""

# ── Prerequisites ──
header "Checking prerequisites..."

COMPOSE_VERSION=$(check_compose)
if [ "$COMPOSE_VERSION" = "none" ]; then
  error "Docker Compose not found."
  echo "  Install Docker Compose: https://docs.docker.com/compose/install/"
  exit 1
fi
success "Docker Compose ${COMPOSE_VERSION} available"

if [ ! -S /var/run/docker.sock ]; then
  error "Docker socket not mounted. Run with: -v /var/run/docker.sock:/var/run/docker.sock"
  exit 1
fi
success "Docker socket available"

if [ ! -d /host/proc ]; then
  error "Host filesystem not mounted. Run with: -v /:/host:ro"
  exit 1
fi
success "Host filesystem readable"
echo ""

# ── Platform Detection ──
header "Detecting platform..."

PLATFORM=$(detect_platform)
case "$PLATFORM" in
  qnap)    info "Detected: QNAP NAS" ;;
  synology) info "Detected: Synology NAS" ;;
  linux)   info "Detected: Generic Linux" ;;
esac

INSTALL_DIR=$(default_install_dir "$PLATFORM")

# Check for existing installation
if [ -f "/host${INSTALL_DIR}/docker-compose.yml" ] && [ -d "/host${INSTALL_DIR}/config" ]; then
  echo ""
  warn "Existing installation found at ${INSTALL_DIR}"

  RUNNING_VERSION=$(get_running_version 3000)
  [ -z "$RUNNING_VERSION" ] && RUNNING_VERSION="not running"

  echo "  Running: v${RUNNING_VERSION}  →  Available: v${BUNDLED_VERSION}"
  echo ""
  echo "  [U] Update containers (keeps all data)"
  echo "  [R] Reconfigure (re-run setup, keeps data)"
  echo "  [F] Fresh install (⚠️ removes config, keeps music)"
  echo "  [Q] Quit"
  echo ""
  read -p "  Select [U/R/F/Q]: " update_choice

  case "$update_choice" in
    [uU])
      header "Updating containers..."
      cd "/host${INSTALL_DIR}"
      docker compose pull
      docker compose --env-file .env --env-file .env.local up -d
      success "Containers updated to v${BUNDLED_VERSION}"

      HOST_IP=$(detect_host_ip)
      PORT=$(grep '^PORT=' .env 2>/dev/null | cut -d= -f2)
      PORT="${PORT:-3000}"

      echo ""
      echo -e "  Open: ${BOLD}http://${HOST_IP}:${PORT}${NC}"
      exit 0
      ;;
    [rR]) ;; # Continue with setup flow
    [fF])
      echo ""
      echo -e "  ${RED}⚠️  Fresh install will DELETE:${NC}"
      echo "    - Your user account(s)"
      echo "    - Listening history (scrobbles)"
      echo "    - All saved credentials"
      echo ""
      echo "    Your music files will NOT be deleted."
      echo ""
      read -p "  Type RESET to confirm: " confirm
      if [ "$confirm" != "RESET" ]; then
        info "Cancelled."
        exit 0
      fi
      rm -rf "/host${INSTALL_DIR}/config"
      info "Config removed. Continuing with fresh setup..."
      ;;
    [qQ]) exit 0 ;;
    *) error "Invalid choice"; exit 1 ;;
  esac
fi

# Confirm install directory
echo ""
read -p "  Install to ${INSTALL_DIR}? [Y/n/path]: " install_choice
case "$install_choice" in
  [nN])
    read -p "  Enter install path: " INSTALL_DIR
    ;;
  ""|[yY]) ;; # keep default
  *) INSTALL_DIR="$install_choice" ;;
esac

# ── Music Folder Selection ──
header "Music Library Setup"
echo "  Where should not-ify store your music library?"
echo ""

# Scan for storage volumes
STORAGE_OPTIONS=()
while IFS='|' read -r path fstype free_gb; do
  [ -n "$path" ] && STORAGE_OPTIONS+=("${path}|${fstype}|${free_gb}")
done < <(scan_storage)

if [ ${#STORAGE_OPTIONS[@]} -gt 0 ]; then
  for i in "${!STORAGE_OPTIONS[@]}"; do
    IFS='|' read -r path fstype free_gb <<< "${STORAGE_OPTIONS[$i]}"
    echo "  [$((i+1))] ${path}  (${free_gb} GB free, ${fstype})"
  done
  echo "  [$((${#STORAGE_OPTIONS[@]}+1))] Browse folders..."
  echo "  [$((${#STORAGE_OPTIONS[@]}+2))] Enter path manually"
  echo ""
  read -p "  Select: " storage_choice

  if [ "$storage_choice" -le ${#STORAGE_OPTIONS[@]} ] 2>/dev/null; then
    idx=$((storage_choice - 1))
    IFS='|' read -r MUSIC_BASE fstype free_gb <<< "${STORAGE_OPTIONS[$idx]}"
  elif [ "$storage_choice" -eq $((${#STORAGE_OPTIONS[@]}+1)) ] 2>/dev/null; then
    MUSIC_BASE=$(browse_folders "/")
  else
    read -p "  Enter full path: " MUSIC_BASE
  fi
else
  warn "No large storage volumes detected."
  echo "  [1] Browse folders..."
  echo "  [2] Enter path manually"
  read -p "  Select: " choice
  if [ "$choice" = "1" ]; then
    MUSIC_BASE=$(browse_folders "/")
  else
    read -p "  Enter full path: " MUSIC_BASE
  fi
fi

# Ask for subfolder name
echo ""
read -p "  Subfolder name [not-ify-music]: " subfolder
subfolder="${subfolder:-not-ify-music}"
MUSIC_DIR="${MUSIC_BASE}/${subfolder}"

# Create and validate
mkdir -p "/host${MUSIC_DIR}" 2>/dev/null || true
if [ ! -d "/host${MUSIC_DIR}" ]; then
  error "Cannot create directory: ${MUSIC_DIR}"
  exit 1
fi
# Test writable
touch "/host${MUSIC_DIR}/.notify-test" 2>/dev/null && rm "/host${MUSIC_DIR}/.notify-test"
if [ $? -ne 0 ]; then
  error "Directory not writable: ${MUSIC_DIR}"
  exit 1
fi
success "Music library: ${MUSIC_DIR}"

# ── Port Conflict Detection ──
header "Checking ports..."

PORT=3000
conflict=$(check_port $PORT)
if [ -n "$conflict" ]; then
  warn "Port ${PORT} is in use by: ${conflict}"
  echo "  [1] Use a different port"
  echo "  [2] Continue anyway"
  echo "  [3] Quit"
  read -p "  Select: " port_choice
  case "$port_choice" in
    1) read -p "  Enter port: " PORT ;;
    3) exit 1 ;;
  esac
fi
success "Port ${PORT} available"

SLSKD_PORT=5030
conflict=$(check_port $SLSKD_PORT)
if [ -n "$conflict" ]; then
  warn "Port ${SLSKD_PORT} (slskd) is in use by: ${conflict}"
  echo "  Soulseek will not be available until the conflict is resolved."
fi

# ── Generate Configuration ──
header "Generating configuration..."

# Create directory structure on host
HOST_DIR="/host${INSTALL_DIR}"
mkdir -p "${HOST_DIR}/config" "${HOST_DIR}/slskd" "${HOST_DIR}/slskd-downloads"

# Generate API key
SLSKD_API_KEY=$(generate_uuid)

# Write .env
cat > "${HOST_DIR}/.env" << EOF
PORT=${PORT}
NODE_ENV=production
LOG_LEVEL=info
DLNA_ENABLED=true
EOF

# Write .env.local
cat > "${HOST_DIR}/.env.local" << EOF
MUSIC_DIR=${MUSIC_DIR}
CONFIG_DIR=${INSTALL_DIR}/config
SLSKD_API_KEY=${SLSKD_API_KEY}
SLSKD_DOWNLOADS_DIR=${INSTALL_DIR}/slskd-downloads
EOF

# Write slskd config
cat > "${HOST_DIR}/slskd/slskd.yml" << EOF
soulseek:
  username:
  password:

web:
  authentication:
    api_keys:
      ${SLSKD_API_KEY}:
        role: administrator

options:
  listen_port: 50300
EOF

# Copy compose template
cp /app/scripts/docker-compose.template.yml "${HOST_DIR}/docker-compose.yml"

success "Configuration written to ${INSTALL_DIR}"
info "  .env, .env.local, docker-compose.yml, slskd/slskd.yml"

# ── Start Containers ──
header "Starting services..."

cd "${HOST_DIR}"
docker compose --env-file .env --env-file .env.local up -d 2>&1

echo ""

# Wait for health
for container in not-ify slskd watchtower; do
  if wait_healthy "$container" 60; then
    local_version=""
    if [ "$container" = "not-ify" ]; then
      local_version=" (v$(get_running_version $PORT))"
    fi
    echo -e "\r  ${GREEN}✅${NC} ${container}${local_version}                    "
  else
    echo -e "\r  ${RED}❌${NC} ${container} — failed to start              "
    echo "     Last logs:"
    docker logs "$container" --tail 5 2>&1 | sed 's/^/     /'
    echo ""
    echo "  [R] Retry  [S] Skip  [Q] Quit"
    read -p "  Select: " health_choice
    case "$health_choice" in
      [rR]) docker restart "$container" && wait_healthy "$container" 30 ;;
      [qQ]) exit 1 ;;
    esac
  fi
done

# ── Print URL ──
echo ""
HOST_IP=$(detect_host_ip)

echo -e "  ${BOLD}══════════════════════════════════════════════${NC}"
echo -e "  ${GREEN}✅ Not-ify is ready!${NC}"
echo ""
echo -e "  Open in your browser:"
echo -e "  ${BOLD}${CYAN}http://${HOST_IP}:${PORT}${NC}"
echo ""
echo -e "  You'll create your account and connect"
echo -e "  your music services from there."
echo -e "  ${BOLD}══════════════════════════════════════════════${NC}"
echo ""
echo "  To manage not-ify later:"
echo "    cd ${INSTALL_DIR}"
echo "    docker compose logs -f          # view logs"
echo "    docker compose restart          # restart"
echo "    docker compose down             # stop"
echo ""
```

- [ ] **Step 2: Make executable and commit**

```bash
chmod +x scripts/setup.sh
git add scripts/setup.sh
git commit -m "feat(setup): add main setup script — platform detect, storage select, compose gen, health check"
```

---

## Phase 4: Testing

### Task 5: Local Docker build + test

- [ ] **Step 1: Build the image**

```bash
docker build -f docker/Dockerfile -t not-ify:setup-test .
```

- [ ] **Step 2: Test setup mode entry**

```bash
docker run --rm not-ify:setup-test setup --help
# Should print the setup banner or help text, not the Node.js server
```

- [ ] **Step 3: Test server mode entry**

```bash
docker run --rm -e PORT=3099 not-ify:setup-test &
sleep 5
curl -s http://localhost:3099/api/health
# Should return health JSON
docker stop $(docker ps -q --filter ancestor=not-ify:setup-test)
```

- [ ] **Step 4: Test full setup flow (dry run)**

```bash
# Full interactive test — requires Docker socket + host mount
docker run --rm -it \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /:/host:ro \
  not-ify:setup-test setup
```

Walk through the setup flow. Verify:
- Platform detected correctly
- Storage volumes listed
- Folder browser works
- Compose file generated
- Containers start
- Health checks pass
- URL printed

- [ ] **Step 5: Run server test suite**

```bash
npm test --prefix packages/server
```

- [ ] **Step 6: Commit any fixes**

---

### Task 6: Push and verify CI

- [ ] **Step 1: Push to main**

```bash
git push origin main
```

- [ ] **Step 2: Monitor CI**

```bash
gh run list --limit 1
gh run watch
```

- [ ] **Step 3: After CI passes, test on staging (QNAP)**

SSH into QNAP and run:

```bash
docker run --rm -it \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /:/host:ro \
  ghcr.io/illtrick/not-ify:latest setup
```

Verify it detects QNAP, finds storage volumes, and generates a working deployment.

---

## Integration Notes

- **The setup script writes to the host filesystem via `/host/` mount** — all paths prefixed with `/host` when writing from inside the container, but stored WITHOUT `/host` prefix in config files (those paths are from the host's perspective).
- **Docker socket access** lets the setup container run `docker compose up` which starts containers on the HOST, not inside the setup container.
- **Watchtower scope** is set to `not-ify` so it only auto-updates not-ify and slskd containers, not other containers on the same host.
- **The compose template uses `network_mode: host`** for DLNA/SSDP multicast discovery. This means port mapping is not used — services bind directly to host ports.
- **slskd credentials are left blank** in the generated `slskd.yml`. The user enters them through the web wizard's Soulseek configuration step, which writes to the DB. The API key is pre-generated and shared between `.env.local` and `slskd.yml`.
