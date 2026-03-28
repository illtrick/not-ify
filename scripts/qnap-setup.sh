#!/usr/bin/env bash
# =============================================================================
# Not-ify — QNAP Initial Setup
# =============================================================================
# Run this script on the QNAP NAS via SSH to set up Not-ify for the first time.
#
# Prerequisites:
#   1. Docker CE installed on QNAP (not Container Station)
#   2. SSH access to the NAS
#   3. GHCR image access (public repo or gh auth)
#
# Usage:
#   ssh admin@nas-ip
#   curl -sL https://raw.githubusercontent.com/illtrick/not-ify/main/scripts/qnap-setup.sh | bash
#   # OR: copy this file and run it

set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/share/Container/not-ify}"

echo "==> Not-ify QNAP Setup"
echo "    Install dir: ${INSTALL_DIR}"

# Create directory structure
mkdir -p "${INSTALL_DIR}"/{music,config,scripts}
cd "${INSTALL_DIR}"

# Download compose files
BASE_URL="https://raw.githubusercontent.com/illtrick/not-ify/main"
for f in docker-compose.yml docker-compose.prod.yml .env.example scripts/deploy.sh; do
  echo "    Downloading ${f}..."
  curl -sL "${BASE_URL}/${f}" -o "${f}"
done

# Create .env from example if it doesn't exist
if [ ! -f .env ]; then
  cp .env.example .env
  echo "    Created .env from .env.example — edit it with your settings"
fi

chmod +x scripts/deploy.sh

echo ""
echo "==> Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit ${INSTALL_DIR}/.env with your settings"
echo "  2. Run: cd ${INSTALL_DIR} && ./scripts/deploy.sh"
echo "  3. Access Not-ify at http://$(hostname -I | awk '{print $1}'):3000"
echo ""
echo "To enable VPN proxy for downloads:"
echo "  1. Add PIA_WG_KEY to .env"
echo "  2. Uncomment PRIVACY_PROXY in .env"
echo "  3. Run: docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile vpn up -d"
