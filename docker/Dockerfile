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
    ffmpeg curl ca-certificates unrar-free python3 \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
       -o /usr/local/bin/yt-dlp && chmod +x /usr/local/bin/yt-dlp \
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

EXPOSE 3000

CMD ["node", "packages/server/src/index.js"]
