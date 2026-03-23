#!/bin/bash
set -e

# ═══════════════════════════════════════════════════════
#   Not-ify — Own Your Sound
#   One-command setup for your personal music server
# ═══════════════════════════════════════════════════════

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

info()    { echo -e "  ${CYAN}▸${NC} $*"; }
success() { echo -e "  ${GREEN}✓${NC} $*"; }
warn()    { echo -e "  ${YELLOW}!${NC} $*"; }
error()   { echo -e "  ${RED}✗${NC} $*"; }

ask() {
  local prompt="$1" default="$2"
  echo -ne "  ${BOLD}${prompt}${NC} " >&2
  [ -n "$default" ] && echo -ne "${DIM}[${default}]${NC} " >&2
  read -r answer
  if [ "$answer" = "q" ] || [ "$answer" = "Q" ]; then
    echo "" >&2
    info "Setup cancelled." >&2
    exit 0
  fi
  echo "${answer:-$default}"
}

confirm() {
  local result
  result=$(ask "$1 [Y/n/q]:" "Y")
  [[ "$result" =~ ^[yY]$ ]] || [ -z "$result" ]
}

# Cleanup on Ctrl+C
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
trap cleanup INT TERM

clear
echo ""
echo -e "  ${BOLD}╔═══════════════════════════════════════╗${NC}"
echo -e "  ${BOLD}║   ${RED}Not-ify${NC}${BOLD}  ·  Own Your Sound          ║${NC}"
echo -e "  ${BOLD}╠═══════════════════════════════════════╣${NC}"
echo -e "  ${BOLD}║${NC}  Self-hosted music server setup        ${BOLD}║${NC}"
echo -e "  ${BOLD}╚═══════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${DIM}This will set up Not-ify on this machine.${NC}"
echo -e "  ${DIM}You can press 'q' at any prompt to quit.${NC}"
echo ""

# ── Prerequisites ──────────────────────────────────
echo -e "  ${BOLD}Step 1/5 · Checking prerequisites${NC}"
echo ""

if ! command -v docker >/dev/null 2>&1; then
  error "Docker is not installed."
  echo ""
  echo "  Install Docker first:"
  echo "    QNAP:      Install 'Container Station' from App Center"
  echo "    Synology:  Install 'Container Manager' from Package Center"
  echo "    Linux:     curl -fsSL https://get.docker.com | sh"
  exit 1
fi
success "Docker installed"

if ! docker compose version >/dev/null 2>&1 && ! docker-compose --version >/dev/null 2>&1; then
  error "Docker Compose not found."
  echo "  Most Docker installations include Compose. Update Docker if needed."
  exit 1
fi
success "Docker Compose available"

if ! docker info >/dev/null 2>&1; then
  error "Cannot connect to Docker. Are you root or in the docker group?"
  exit 1
fi
success "Docker connection OK"
echo ""

# ── Platform Detection ─────────────────────────────
echo -e "  ${BOLD}Step 2/5 · Detecting your system${NC}"
echo ""

PLATFORM="linux"
if grep -q '/share/CACHEDEV' /proc/mounts 2>/dev/null; then
  PLATFORM="qnap"
  info "Detected: ${BOLD}QNAP NAS${NC}"
elif grep -q '/volume[0-9]' /proc/mounts 2>/dev/null; then
  PLATFORM="synology"
  info "Detected: ${BOLD}Synology NAS${NC}"
else
  info "Detected: ${BOLD}Linux${NC}"
fi

# Default install dir
case "$PLATFORM" in
  qnap)     DEFAULT_INSTALL="/share/CACHEDEV1_DATA/not-ify" ;;
  synology) DEFAULT_INSTALL="/volume1/docker/not-ify" ;;
  *)        DEFAULT_INSTALL="/opt/not-ify" ;;
esac

echo ""
echo -e "  ${DIM}Not-ify needs a home for its config files (database,${NC}"
echo -e "  ${DIM}settings, docker-compose). This is NOT your music folder —${NC}"
echo -e "  ${DIM}you'll choose that next.${NC}"
echo ""
INSTALL_DIR=$(ask "Config directory:" "$DEFAULT_INSTALL")
echo ""

# ── Music Library Selection ────────────────────────
echo -e "  ${BOLD}Step 3/5 · Choose your music library${NC}"
echo ""
echo -e "  ${DIM}This is where Not-ify stores your music files.${NC}"
echo -e "  ${DIM}Pick a drive with plenty of space — music libraries grow!${NC}"
echo ""

# Scan for storage volumes
STORAGE_PATHS=""
STORAGE_INFO=""
STORAGE_COUNT=0
while IFS= read -r line; do
  mount_path=$(echo "$line" | awk '{print $6}')
  free_gb=$(echo "$line" | awk '{print int($4/1048576)}')
  if [ "$free_gb" -gt 1 ] 2>/dev/null; then
    # Filter out system paths
    case "$mount_path" in
      /proc|/sys|/dev|/run|/tmp|/boot|/mnt/HDA_ROOT|/mnt/boot) continue ;;
      /proc/*|/sys/*|/dev/*|/run/*|/tmp/*|/boot/*) continue ;;
    esac
    STORAGE_COUNT=$((STORAGE_COUNT + 1))
    STORAGE_PATHS="${STORAGE_PATHS}${mount_path}
"
    STORAGE_INFO="${STORAGE_INFO}${mount_path}  (${free_gb} GB free)
"
  fi
done < <(df -T 2>/dev/null | grep -E 'ext[234]|btrfs|xfs' | awk '{print $1, $2, $3, $4, $5, $6, $7}')

if [ "$STORAGE_COUNT" -gt 0 ]; then
  echo "  Available storage:"
  echo ""
  i=1
  while IFS= read -r entry; do
    [ -z "$entry" ] && continue
    echo -e "    ${BOLD}[$i]${NC} $entry"
    i=$((i + 1))
  done <<EOF
$STORAGE_INFO
EOF
  EXTRA=$((STORAGE_COUNT + 1))
  echo -e "    ${BOLD}[${EXTRA}]${NC} Enter path manually"
  echo ""
  CHOICE=$(ask "Select:" "1")

  if [ "$CHOICE" -le "$STORAGE_COUNT" ] 2>/dev/null; then
    idx=1
    MUSIC_BASE=""
    while IFS= read -r entry; do
      [ -z "$entry" ] && continue
      if [ "$idx" -eq "$CHOICE" ]; then
        MUSIC_BASE="$entry"
        break
      fi
      idx=$((idx + 1))
    done <<EOF
$STORAGE_PATHS
EOF
  else
    MUSIC_BASE=$(ask "Full path to music storage:")
  fi
else
  warn "No large storage volumes detected."
  MUSIC_BASE=$(ask "Full path to music storage:")
fi

# Browse into the selected volume
echo ""
echo -e "  ${DIM}Navigate to where you want your music library.${NC}"
echo -e "  ${DIM}You can select an existing folder or create a new one.${NC}"
echo ""

CURRENT_DIR="$MUSIC_BASE"
while true; do
  echo -e "  ${BOLD}📁 ${CURRENT_DIR}${NC}"
  echo ""

  # List subdirectories
  SUBDIRS=""
  SUBCOUNT=0
  for d in "$CURRENT_DIR"/*/; do
    [ -d "$d" ] || continue
    dirname=$(basename "$d")
    case "$dirname" in
      '@'*|'.'*|'$'*|lost+found) continue ;;  # skip system dirs
    esac
    SUBCOUNT=$((SUBCOUNT + 1))
    SUBDIRS="${SUBDIRS}${dirname}
"
    [ "$SUBCOUNT" -ge 15 ] && break
  done

  if [ "$SUBCOUNT" -gt 0 ]; then
    i=1
    while IFS= read -r entry; do
      [ -z "$entry" ] && continue
      echo -e "    ${BOLD}[$i]${NC} $entry/"
      i=$((i + 1))
    done <<DIREOF
$SUBDIRS
DIREOF
  else
    echo -e "    ${DIM}(no subdirectories)${NC}"
  fi

  echo ""
  echo -e "    ${BOLD}[S]${NC} Select this folder"
  echo -e "    ${BOLD}[N]${NC} Create new folder here"
  echo -e "    ${BOLD}[U]${NC} Go up"
  echo ""
  NAV_CHOICE=$(ask "Choice:" "S")

  case "$NAV_CHOICE" in
    [sS]) break ;;
    [nN])
      NEW_NAME=$(ask "New folder name:" "not-ify-music")
      mkdir -p "${CURRENT_DIR}/${NEW_NAME}" 2>/dev/null
      if [ -d "${CURRENT_DIR}/${NEW_NAME}" ]; then
        CURRENT_DIR="${CURRENT_DIR}/${NEW_NAME}"
        break
      else
        error "Failed to create folder" >&2
      fi
      ;;
    [uU]) CURRENT_DIR=$(dirname "$CURRENT_DIR") ;;
    [0-9]*)
      idx=1
      while IFS= read -r entry; do
        [ -z "$entry" ] && continue
        if [ "$idx" -eq "$NAV_CHOICE" ]; then
          CURRENT_DIR="${CURRENT_DIR}/${entry}"
          break
        fi
        idx=$((idx + 1))
      done <<DIREOF2
$SUBDIRS
DIREOF2
      ;;
  esac
done

MUSIC_DIR="$CURRENT_DIR"

# Create and validate
mkdir -p "$MUSIC_DIR" 2>/dev/null || true
if [ ! -d "$MUSIC_DIR" ]; then
  error "Cannot create directory: $MUSIC_DIR"
  exit 1
fi
if ! touch "$MUSIC_DIR/.notify-test" 2>/dev/null; then
  error "Directory not writable: $MUSIC_DIR"
  exit 1
fi
rm -f "$MUSIC_DIR/.notify-test"
success "Music library: ${BOLD}$MUSIC_DIR${NC}"
echo ""

# ── Port Check ─────────────────────────────────────
echo -e "  ${BOLD}Step 4/5 · Network configuration${NC}"
echo ""

PORT=3000
PORT_IN_USE=0
if command -v ss >/dev/null 2>&1; then
  if ss -tlnp 2>/dev/null | grep -q ":${PORT} "; then
    PORT_IN_USE=1
  fi
elif command -v netstat >/dev/null 2>&1; then
  if netstat -tlnp 2>/dev/null | grep -q ":${PORT} "; then
    PORT_IN_USE=1
  fi
fi

if [ "$PORT_IN_USE" -eq 1 ]; then
  warn "Port $PORT is already in use."
  PORT=$(ask "Use a different port:" "3001")
fi
success "Web UI will be on port ${BOLD}$PORT${NC}"
echo ""

# ── Create config & launch Docker setup ────────────
echo -e "  ${BOLD}Step 5/5 · Installing Not-ify${NC}"
echo ""

# Create install directory structure
mkdir -p "$INSTALL_DIR/config" "$INSTALL_DIR/slskd" "$INSTALL_DIR/slskd-downloads"

# Generate API key
if [ -f /proc/sys/kernel/random/uuid ]; then
  SLSKD_API_KEY=$(cat /proc/sys/kernel/random/uuid)
elif command -v xxd >/dev/null 2>&1; then
  SLSKD_API_KEY=$(head -c 16 /dev/urandom | xxd -p)
else
  SLSKD_API_KEY="notify-$(date +%s)-$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')"
fi

info "Pulling latest Not-ify image..."
docker pull ghcr.io/illtrick/not-ify:latest 2>&1 | grep -E 'Pulling|Digest|Status|latest' | sed 's/^/  /' || true
echo ""

info "Generating configuration and starting services..."
echo ""

# Run the Docker setup container — it generates configs and starts services.
# No root mount needed: bootstrap.sh has already handled filesystem browsing.
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "${INSTALL_DIR}:/host/install" \
  -e NOTIFY_INSTALL_DIR="$INSTALL_DIR" \
  -e NOTIFY_MUSIC_DIR="$MUSIC_DIR" \
  -e NOTIFY_PORT="$PORT" \
  -e NOTIFY_SLSKD_API_KEY="$SLSKD_API_KEY" \
  ghcr.io/illtrick/not-ify:latest setup \
    --install-dir="$INSTALL_DIR" \
    --music-dir="$MUSIC_DIR" \
    --port="$PORT" \
    --api-key="$SLSKD_API_KEY"

# Check if containers started successfully
echo ""
if docker ps --filter name=not-ify --format '{{.Names}}' 2>/dev/null | grep -q 'not-ify'; then
  # Detect LAN IP (multiple methods for compatibility)
  HOST_IP=""
  # Method 1: hostname -I (most Linux)
  [ -z "$HOST_IP" ] && HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  # Method 2: ip route (works on busybox)
  [ -z "$HOST_IP" ] && HOST_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '/src/{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')
  # Method 3: ifconfig (QNAP/older systems)
  [ -z "$HOST_IP" ] && HOST_IP=$(ifconfig 2>/dev/null | grep 'inet ' | grep -v '127.0.0.1' | head -1 | awk '{print $2}' | sed 's/addr://')
  # Method 4: hostname lookup
  [ -z "$HOST_IP" ] && HOST_IP=$(hostname 2>/dev/null)
  [ -z "$HOST_IP" ] && HOST_IP="<your-server-ip>"

  echo ""
  echo -e "  ${BOLD}═══════════════════════════════════════════${NC}"
  echo ""
  echo -e "  ${GREEN}✓${NC} ${BOLD}Not-ify is running!${NC}"
  echo ""
  echo -e "  Open in your browser:"
  echo -e "  ${BOLD}${CYAN}http://${HOST_IP}:${PORT}${NC}"
  echo ""
  echo -e "  ${DIM}You'll create your account and connect${NC}"
  echo -e "  ${DIM}your music services from there.${NC}"
  echo ""
  echo -e "  ${BOLD}═══════════════════════════════════════════${NC}"
  echo ""
  echo -e "  ${DIM}Manage Not-ify:${NC}"
  echo -e "    cd $INSTALL_DIR"
  echo -e "    docker compose logs -f        ${DIM}# view logs${NC}"
  echo -e "    docker compose restart        ${DIM}# restart${NC}"
  echo -e "    docker compose down           ${DIM}# stop all${NC}"
  echo ""
  echo -e "  ${DIM}Update Not-ify:${NC}"
  echo -e "    docker pull ghcr.io/illtrick/not-ify:latest"
  echo -e "    cd $INSTALL_DIR && docker compose up -d"
  echo ""
else
  error "Containers did not start. Check logs:"
  echo "    docker logs not-ify"
fi
