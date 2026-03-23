#!/bin/bash
set -e

# Source library functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
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
