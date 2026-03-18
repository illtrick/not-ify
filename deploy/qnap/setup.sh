#!/bin/bash
# =============================================================================
# Not-ify QNAP Setup Script
# Run this once on the NAS via SSH to initialize the deployment
# =============================================================================
set -e

DEPLOY_DIR="/share/DataVol1/Container/not-ify"

echo "=== Not-ify QNAP Setup ==="

# Create directory structure
echo "Creating directories..."
mkdir -p "$DEPLOY_DIR"/{prod/music,prod/config,staging/music,staging/config}

# Download compose + env files from the repo
echo "Downloading deployment files..."
cd "$DEPLOY_DIR"

curl -sL "https://raw.githubusercontent.com/illtrick/not-ify/main/deploy/qnap/docker-compose.yml" -o docker-compose.yml
curl -sL "https://raw.githubusercontent.com/illtrick/not-ify/main/deploy/qnap/.env" -o .env

echo ""
echo "=== Setup complete ==="
echo ""
echo "Directory structure:"
echo "  $DEPLOY_DIR/"
echo "  ├── docker-compose.yml"
echo "  ├── .env                    ← edit PROD_VERSION here"
echo "  ├── prod/"
echo "  │   ├── music/              ← production music library"
echo "  │   └── config/             ← production config + DB"
echo "  └── staging/"
echo "      ├── music/              ← staging music library"
echo "      └── config/             ← staging config + DB"
echo ""
echo "Next steps:"
echo "  1. Make sure you're logged into GHCR:"
echo "     docker login ghcr.io -u illtrick"
echo ""
echo "  2. Start everything:"
echo "     cd $DEPLOY_DIR && docker compose up -d"
echo ""
echo "  3. Access:"
echo "     Production: http://<nas-ip>:3000"
echo "     Staging:    http://<nas-ip>:3001"
echo ""
echo "  4. To promote a release to prod:"
echo "     Edit .env → change PROD_VERSION=v0.2.0"
echo "     docker compose up -d"
