#!/bin/bash
set -e

# Source library functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
source "${SCRIPT_DIR}/setup-lib.sh"

# ═══════════════════════════════════════════════
#  Not-ify — Own Your Sound
#  Container-side setup: receives pre-configured
#  paths from bootstrap.sh and handles compose
#  generation, config writing, and startup.
# ═══════════════════════════════════════════════

# Parse args
INSTALL_DIR="" MUSIC_DIR="" PORT="" API_KEY=""
for arg in "$@"; do
  case "$arg" in
    --install-dir=*) INSTALL_DIR="${arg#*=}" ;;
    --music-dir=*)   MUSIC_DIR="${arg#*=}" ;;
    --port=*)        PORT="${arg#*=}" ;;
    --api-key=*)     API_KEY="${arg#*=}" ;;
    --help|-h)
      echo "Not-ify setup (container-side)"
      echo ""
      echo "Usage: docker run ... ghcr.io/illtrick/not-ify:latest setup [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --install-dir=PATH  Install directory on host (required)"
      echo "  --music-dir=PATH    Music library path on host (required)"
      echo "  --port=PORT         Web UI port (default: 3000)"
      echo "  --api-key=KEY       slskd API key (auto-generated if omitted)"
      echo ""
      echo "Tip: Run bootstrap.sh on the host instead of calling this directly."
      echo "  curl -sL https://raw.githubusercontent.com/illtrick/not-ify/main/scripts/bootstrap.sh | bash"
      exit 0 ;;
  esac
done

# Use env vars as fallback
INSTALL_DIR="${INSTALL_DIR:-$NOTIFY_INSTALL_DIR}"
MUSIC_DIR="${MUSIC_DIR:-$NOTIFY_MUSIC_DIR}"
PORT="${PORT:-${NOTIFY_PORT:-3000}}"
API_KEY="${API_KEY:-${NOTIFY_SLSKD_API_KEY:-$(generate_uuid)}}"

HOST_INSTALL="/host/install"

if [ -z "$INSTALL_DIR" ] || [ -z "$MUSIC_DIR" ]; then
  error "Missing required arguments --install-dir and --music-dir."
  echo ""
  echo "  Run bootstrap.sh on the host for the full interactive setup:"
  echo "    curl -sL https://raw.githubusercontent.com/illtrick/not-ify/main/scripts/bootstrap.sh | bash"
  exit 1
fi

# Verify Docker socket is available
if [ ! -S /var/run/docker.sock ]; then
  error "Docker socket not mounted."
  echo "  Run with: -v /var/run/docker.sock:/var/run/docker.sock"
  exit 1
fi

# Verify install dir is mounted
if [ ! -d "$HOST_INSTALL" ]; then
  error "Install directory not mounted at $HOST_INSTALL"
  echo "  Run with: -v ${INSTALL_DIR}:/host/install"
  exit 1
fi

BUNDLED_VERSION=$(get_bundled_version)
info "Not-ify v${BUNDLED_VERSION}"
echo ""

# Check for existing installation
if [ -f "${HOST_INSTALL}/docker-compose.yml" ] && [ -d "${HOST_INSTALL}/config" ]; then
  warn "Existing installation found."
  RUNNING_VERSION=$(get_running_version "$PORT")
  [ -z "$RUNNING_VERSION" ] && RUNNING_VERSION="not running"
  info "Running: v${RUNNING_VERSION}  →  Available: v${BUNDLED_VERSION}"
  echo ""
  info "Updating containers (existing data preserved)..."
  cd "${HOST_INSTALL}"
  docker compose pull 2>&1 | sed 's/^/  /' || true
  docker compose --env-file .env --env-file .env.local up -d 2>&1 | sed 's/^/  /'
  success "Updated to v${BUNDLED_VERSION}"
  exit 0
fi

info "Generating configuration..."

# Write .env
cat > "${HOST_INSTALL}/.env" << EOF
PORT=${PORT}
NODE_ENV=production
LOG_LEVEL=info
DLNA_ENABLED=true
EOF

# Write .env.local
cat > "${HOST_INSTALL}/.env.local" << EOF
MUSIC_DIR=${MUSIC_DIR}
CONFIG_DIR=${INSTALL_DIR}/config
SLSKD_API_KEY=${API_KEY}
SLSKD_DOWNLOADS_DIR=${INSTALL_DIR}/slskd-downloads
EOF

# Write slskd config
mkdir -p "${HOST_INSTALL}/slskd"
cat > "${HOST_INSTALL}/slskd/slskd.yml" << EOF
soulseek:
  username:
  password:

web:
  authentication:
    api_keys:
      ${API_KEY}:
        role: administrator

options:
  listen_port: 50300
EOF

# Copy compose template
cp "${SCRIPT_DIR}/docker-compose.template.yml" "${HOST_INSTALL}/docker-compose.yml"

success "Configuration written"

# Start containers
info "Starting services..."
cd "${HOST_INSTALL}"
docker compose --env-file .env --env-file .env.local up -d 2>&1 | sed 's/^/  /'

echo ""

# Health checks
for container in not-ify slskd watchtower; do
  if wait_healthy "$container" 60; then
    version_suffix=""
    if [ "$container" = "not-ify" ]; then
      running_ver=$(get_running_version "$PORT")
      [ -n "$running_ver" ] && version_suffix=" (v${running_ver})"
    fi
    success "${container}${version_suffix}"
  else
    warn "${container} — may still be starting"
    docker logs "$container" --tail 3 2>&1 | sed 's/^/    /' || true
  fi
done
