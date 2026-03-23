#!/bin/bash
# setup-lib.sh — Reusable functions for the Not-ify container-side setup script

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# Print helpers
info()    { echo -e "  ${CYAN}▸${NC} $*"; }
success() { echo -e "  ${GREEN}✓${NC} $*"; }
warn()    { echo -e "  ${YELLOW}!${NC} $*"; }
error()   { echo -e "  ${RED}✗${NC} $*"; }
header()  { echo -e "\n  ${BOLD}$*${NC}\n"; }

# Wait for a container to become healthy
wait_healthy() {
  local container="$1"
  local timeout="${2:-60}"
  local elapsed=0

  while [ $elapsed -lt $timeout ]; do
    local status
    status=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || true)
    case "$status" in
      healthy)   return 0 ;;
      unhealthy) return 1 ;;
    esac
    # No health check defined — just check if running
    local running
    running=$(docker inspect --format='{{.State.Running}}' "$container" 2>/dev/null || true)
    if [ "$running" = "true" ] && [ -z "$status" ]; then
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
    printf "\r  ${CYAN}▸${NC} Waiting for %s (%ds)..." "$container" "$elapsed"
  done
  echo ""
  return 1
}

# Generate a UUID (for API keys)
generate_uuid() {
  if [ -f /proc/sys/kernel/random/uuid ]; then
    cat /proc/sys/kernel/random/uuid
  elif command -v xxd >/dev/null 2>&1; then
    head -c 16 /dev/urandom | xxd -p
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 32
  fi
}

# Get version from package.json inside the setup container
get_bundled_version() {
  node -e "console.log(require('/app/package.json').version)" 2>/dev/null || echo "unknown"
}

# Get running version from a Not-ify instance
get_running_version() {
  local port="$1"
  curl -s --connect-timeout 3 "http://localhost:${port}/api/health" 2>/dev/null | \
    grep -o '"version":"[^"]*"' | cut -d'"' -f4 || true
}

# Check if Docker Compose v2 is available
check_compose() {
  if docker compose version >/dev/null 2>&1; then
    echo "v2"
  elif docker-compose --version >/dev/null 2>&1; then
    echo "v1"
  else
    echo "none"
  fi
}

# Detect host LAN IP from inside the container
detect_host_ip() {
  # Method 1: Docker API
  local ip
  ip=$(curl -s --unix-socket /var/run/docker.sock http://localhost/info 2>/dev/null | \
    grep -o '"NodeAddr":"[^"]*"' | cut -d'"' -f4 || true)
  if [ -n "$ip" ] && [ "$ip" != "null" ] && [ "$ip" != "0.0.0.0" ]; then
    echo "$ip"; return
  fi

  # Method 2: Parse host route table via mounted /proc
  local iface
  iface=$(awk '$2 == "00000000" {print $1; exit}' /proc/net/route 2>/dev/null || true)
  if [ -n "$iface" ]; then
    ip=$(grep -A1 "/$iface" /proc/net/fib_trie 2>/dev/null | \
      grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)
    if [ -n "$ip" ]; then echo "$ip"; return; fi
  fi

  # Method 3: ip route fallback
  ip=$(ip route get 1.1.1.1 2>/dev/null | grep -oE 'src [0-9.]+' | awk '{print $2}' || true)
  if [ -n "$ip" ]; then echo "$ip"; return; fi

  echo "localhost"
}
