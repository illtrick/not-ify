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

# ── Reusable folder browser ──────────────────────────
# Usage: RESULT=$(browse_folder "/start/path" "prompt text")
browse_folder() {
  local start_dir="$1" prompt_text="$2"
  local current_dir="$start_dir"

  echo "" >&2
  echo -e "  ${DIM}${prompt_text}${NC}" >&2
  echo "" >&2

  while true; do
    echo -e "  ${BOLD}📁 ${current_dir}${NC}" >&2
    echo "" >&2

    local subdirs="" subcount=0
    for d in "$current_dir"/*/; do
      [ -d "$d" ] || continue
      local dname
      dname=$(basename "$d")
      case "$dname" in
        '@'*|'.'*|'$'*|lost+found) continue ;;
      esac
      subcount=$((subcount + 1))
      subdirs="${subdirs}${dname}
"
      [ "$subcount" -ge 15 ] && break
    done

    if [ "$subcount" -gt 0 ]; then
      local i=1
      while IFS= read -r entry; do
        [ -z "$entry" ] && continue
        echo -e "    ${BOLD}[$i]${NC} $entry/" >&2
        i=$((i + 1))
      done <<BEOF
$subdirs
BEOF
    else
      echo -e "    ${DIM}(no subdirectories)${NC}" >&2
    fi

    echo "" >&2
    echo -e "    ${BOLD}[S]${NC} Select this folder" >&2
    echo -e "    ${BOLD}[N]${NC} Create new folder here" >&2
    echo -e "    ${BOLD}[U]${NC} Go up" >&2
    echo "" >&2
    local nav_choice
    nav_choice=$(ask "Choice:" "S")

    case "$nav_choice" in
      [sS]) break ;;
      [nN])
        local new_name
        new_name=$(ask "New folder name:" "not-ify")
        mkdir -p "${current_dir}/${new_name}" 2>/dev/null
        if [ -d "${current_dir}/${new_name}" ]; then
          current_dir="${current_dir}/${new_name}"
          break
        else
          error "Failed to create folder" >&2
        fi
        ;;
      [uU]) current_dir=$(dirname "$current_dir") ;;
      [0-9]*)
        local idx=1
        while IFS= read -r entry; do
          [ -z "$entry" ] && continue
          if [ "$idx" -eq "$nav_choice" ]; then
            current_dir="${current_dir}/${entry}"
            break
          fi
          idx=$((idx + 1))
        done <<BEOF2
$subdirs
BEOF2
        ;;
    esac
  done

  echo "$current_dir"
}

# ── Scan storage volumes ─────────────────────────────
# Populates STORAGE_PATHS, STORAGE_INFO, STORAGE_COUNT
scan_storage() {
  STORAGE_PATHS=""
  STORAGE_INFO=""
  STORAGE_COUNT=0
  while IFS= read -r line; do
    local mount_path free_gb
    mount_path=$(echo "$line" | awk '{print $6}')
    free_gb=$(echo "$line" | awk '{print int($4/1048576)}')
    if [ "$free_gb" -gt 1 ] 2>/dev/null; then
      case "$mount_path" in
        /proc|/sys|/dev|/run|/tmp|/boot|/mnt/HDA_ROOT|/mnt/boot|/mnt/ext) continue ;;
        /proc/*|/sys/*|/dev/*|/run/*|/tmp/*|/boot/*|/mnt/pool*) continue ;;
      esac
      STORAGE_COUNT=$((STORAGE_COUNT + 1))
      STORAGE_PATHS="${STORAGE_PATHS}${mount_path}
"
      STORAGE_INFO="${STORAGE_INFO}${mount_path}  (${free_gb} GB free)
"
    fi
  done < <(df -T 2>/dev/null | grep -E 'ext[234]|btrfs|xfs' | awk '{print $1, $2, $3, $4, $5, $6, $7}')
}

# Pick a storage volume from the scanned list, or manual entry
# Usage: BASE_PATH=$(pick_volume)
pick_volume() {
  if [ "$STORAGE_COUNT" -gt 0 ]; then
    echo "  Available storage:" >&2
    echo "" >&2
    local i=1
    while IFS= read -r entry; do
      [ -z "$entry" ] && continue
      echo -e "    ${BOLD}[$i]${NC} $entry" >&2
      i=$((i + 1))
    done <<PVEOF
$STORAGE_INFO
PVEOF
    local extra=$((STORAGE_COUNT + 1))
    echo -e "    ${BOLD}[${extra}]${NC} Enter path manually" >&2
    echo "" >&2
    local choice
    choice=$(ask "Select:" "1")

    if [ "$choice" -le "$STORAGE_COUNT" ] 2>/dev/null; then
      local idx=1
      while IFS= read -r entry; do
        [ -z "$entry" ] && continue
        if [ "$idx" -eq "$choice" ]; then
          echo "$entry"
          return
        fi
        idx=$((idx + 1))
      done <<PVEOF2
$STORAGE_PATHS
PVEOF2
    fi
  else
    warn "No large storage volumes detected." >&2
  fi
  ask "Full path:"
}

# Detect LAN IP
detect_ip() {
  local ip=""
  ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  [ -z "$ip" ] && ip=$(ip route get 1.1.1.1 2>/dev/null | awk '/src/{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')
  [ -z "$ip" ] && ip=$(ifconfig 2>/dev/null | grep 'inet ' | grep -v '127.0.0.1' | head -1 | awk '{print $2}' | sed 's/addr://')
  [ -z "$ip" ] && ip=$(hostname 2>/dev/null)
  [ -z "$ip" ] && ip="<your-server-ip>"
  echo "$ip"
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

# ── Step 1: Prerequisites ────────────────────────────
echo -e "  ${BOLD}Step 1/6 · Checking prerequisites${NC}"
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

# ── Step 2: Platform Detection ───────────────────────
echo -e "  ${BOLD}Step 2/6 · Detecting your system${NC}"
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

# Scan available storage once — used by both config and music steps
scan_storage

echo ""

# ── Step 3: Config Directory ─────────────────────────
echo -e "  ${BOLD}Step 3/6 · Config directory${NC}"
echo ""
echo -e "  ${DIM}Where should Not-ify store its configuration?${NC}"
echo -e "  ${DIM}(database, settings, docker-compose — NOT music)${NC}"
echo ""

# Offer quick default or browse
case "$PLATFORM" in
  qnap)     DEFAULT_INSTALL="/share/CACHEDEV1_DATA/not-ify" ;;
  synology) DEFAULT_INSTALL="/volume1/docker/not-ify" ;;
  *)        DEFAULT_INSTALL="/opt/not-ify" ;;
esac

echo -e "    ${BOLD}[1]${NC} Use default: ${BOLD}${DEFAULT_INSTALL}${NC}"
echo -e "    ${BOLD}[2]${NC} Browse and select folder"
echo -e "    ${BOLD}[3]${NC} Enter path manually"
echo ""
CONFIG_CHOICE=$(ask "Select:" "1")

case "$CONFIG_CHOICE" in
  1) INSTALL_DIR="$DEFAULT_INSTALL" ;;
  2)
    CONFIG_BASE=$(pick_volume)
    INSTALL_DIR=$(browse_folder "$CONFIG_BASE" "Navigate to where you want Not-ify's config folder.")
    # Ensure it ends in a not-ify subfolder
    case "$INSTALL_DIR" in
      *not-ify*|*notify*) ;; # already has it
      *) INSTALL_DIR="${INSTALL_DIR}/not-ify" ;;
    esac
    ;;
  *)
    INSTALL_DIR=$(ask "Config directory path:" "$DEFAULT_INSTALL")
    ;;
esac

mkdir -p "$INSTALL_DIR" 2>/dev/null || true
if [ ! -d "$INSTALL_DIR" ]; then
  error "Cannot create directory: $INSTALL_DIR"
  exit 1
fi
success "Config directory: ${BOLD}$INSTALL_DIR${NC}"
echo ""

# ── Step 4: Music Library ────────────────────────────
echo -e "  ${BOLD}Step 4/6 · Music library${NC}"
echo ""
echo -e "  ${DIM}Where should Not-ify store your music files?${NC}"
echo -e "  ${DIM}Pick a drive with plenty of space — libraries grow!${NC}"
echo ""

MUSIC_BASE=$(pick_volume)
MUSIC_DIR=$(browse_folder "$MUSIC_BASE" "Navigate to your music folder, or create a new one.")

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

# ── Step 5: Optional Services ────────────────────────
echo -e "  ${BOLD}Step 5/6 · Optional services${NC}"
echo ""
echo -e "  ${DIM}Not-ify works best with these additional services.${NC}"
echo -e "  ${DIM}You can always add them later from Settings.${NC}"
echo ""

ENABLE_VPN="n"
ENABLE_CLAMAV="n"

echo -e "  ${BOLD}VPN (Gluetun)${NC}"
echo -e "  ${DIM}Routes torrent traffic through a VPN for privacy.${NC}"
echo -e "  ${DIM}Supports PIA, Mullvad, NordVPN, and 30+ providers.${NC}"
if confirm "Enable VPN?"; then
  ENABLE_VPN="y"
  success "VPN will be installed"
else
  info "Skipped — you can enable VPN in Settings later"
fi
echo ""

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

# ── Step 6: Port & Install ───────────────────────────
echo -e "  ${BOLD}Step 6/6 · Installing Not-ify${NC}"
echo ""

PORT=3000
PORT_IN_USE=0
if command -v ss >/dev/null 2>&1; then
  ss -tlnp 2>/dev/null | grep -q ":${PORT} " && PORT_IN_USE=1
elif command -v netstat >/dev/null 2>&1; then
  netstat -tlnp 2>/dev/null | grep -q ":${PORT} " && PORT_IN_USE=1
fi

if [ "$PORT_IN_USE" -eq 1 ]; then
  warn "Port $PORT is already in use."
  PORT=$(ask "Use a different port:" "3001")
fi
success "Web UI will be on port ${BOLD}$PORT${NC}"
echo ""

# Create install directory structure
mkdir -p "$INSTALL_DIR/config" "$INSTALL_DIR/slskd" "$INSTALL_DIR/slskd-downloads"

# Generate API key (compatible with busybox)
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

# Run the Docker setup container — generates configs and starts services.
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "${INSTALL_DIR}:/host/install" \
  -e NOTIFY_INSTALL_DIR="$INSTALL_DIR" \
  -e NOTIFY_MUSIC_DIR="$MUSIC_DIR" \
  -e NOTIFY_PORT="$PORT" \
  -e NOTIFY_SLSKD_API_KEY="$SLSKD_API_KEY" \
  -e NOTIFY_ENABLE_VPN="$ENABLE_VPN" \
  -e NOTIFY_ENABLE_CLAMAV="$ENABLE_CLAMAV" \
  ghcr.io/illtrick/not-ify:latest setup \
    --install-dir="$INSTALL_DIR" \
    --music-dir="$MUSIC_DIR" \
    --port="$PORT" \
    --api-key="$SLSKD_API_KEY" \
    --vpn="$ENABLE_VPN" \
    --clamav="$ENABLE_CLAMAV"

# Check if containers started successfully
echo ""
if docker ps --filter name=not-ify --format '{{.Names}}' 2>/dev/null | grep -q 'not-ify'; then
  HOST_IP=$(detect_ip)

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
