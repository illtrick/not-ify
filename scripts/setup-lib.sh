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
