# =============================================================================
# Not-ify Production Dockerfile — Multi-stage build
# =============================================================================

# Stage 1: Build client + install all deps (including native modules like better-sqlite3)
FROM node:20-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY packages/shared/package.json packages/shared/
RUN npm ci --workspaces
COPY packages/ packages/
RUN npm run build -w @not-ify/client

# Stage 2: Production image — only runtime deps
FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg curl ca-certificates unrar-free python3 file bash whiptail jq tini \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
       -o /usr/local/bin/yt-dlp && chmod +x /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

# Install Docker CLI + Compose plugin (for setup script to manage host containers)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gnupg lsb-release \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy root package.json (needed for version reading)
COPY --from=build /app/package.json .

# Copy workspace node_modules (hoisted)
COPY --from=build /app/node_modules/ node_modules/

# Copy server source + its node_modules
COPY --from=build /app/packages/server/ packages/server/

# Copy shared source
COPY --from=build /app/packages/shared/ packages/shared/

# Copy only the built client (no source, no devDeps)
COPY --from=build /app/packages/client/dist/ packages/client/dist/

# Copy setup scripts (bootstrap.sh included for extraction by users)
COPY scripts/bootstrap.sh /app/scripts/bootstrap.sh
COPY scripts/entrypoint.sh /app/scripts/entrypoint.sh
COPY scripts/setup.sh /app/scripts/setup.sh
COPY scripts/setup-lib.sh /app/scripts/setup-lib.sh
COPY scripts/docker-compose.template.yml /app/scripts/docker-compose.template.yml
COPY scripts/healthcheck.js /app/scripts/healthcheck.js
RUN chmod +x /app/scripts/*.sh

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node /app/scripts/healthcheck.js

EXPOSE 3000

ENTRYPOINT ["/app/scripts/entrypoint.sh"]
CMD ["server"]
