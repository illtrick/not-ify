#!/usr/bin/env bash
# =============================================================================
# Not-ify — Production Deploy Script
# =============================================================================
# Pulls the latest image from GHCR and restarts the service.
#
# Usage (on the production server):
#   ./scripts/deploy.sh              # deploy latest
#   ./scripts/deploy.sh v1.2.0       # deploy specific version
#
# Usage (from dev machine via SSH):
#   ssh nas "cd /path/to/not-ify && ./scripts/deploy.sh"

set -euo pipefail

VERSION="${1:-latest}"
IMAGE="ghcr.io/${GITHUB_USER:-illtrick}/not-ify:${VERSION}"
COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"

echo "==> Deploying Not-ify ${VERSION}"
echo "    Image: ${IMAGE}"

# Pull the latest image
echo "==> Pulling image..."
docker pull "${IMAGE}"

# Restart with zero downtime (stop old, start new)
echo "==> Restarting service..."
docker compose ${COMPOSE_FILES} up -d --no-build

echo "==> Waiting for health check..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:${PORT:-3000}/api/health > /dev/null 2>&1; then
    echo "==> Not-ify ${VERSION} is healthy!"
    exit 0
  fi
  sleep 1
done

echo "==> WARNING: Health check failed after 30s. Check logs:"
echo "    docker compose ${COMPOSE_FILES} logs --tail=50 not-ify"
exit 1
