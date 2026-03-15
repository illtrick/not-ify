FROM node:20-slim

# Install ffmpeg for audio handling
RUN apt-get update && apt-get install -y ffmpeg curl && rm -rf /var/lib/apt/lists/* \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp

WORKDIR /app

# Copy server package.json and install deps (cached layer)
COPY server/package*.json ./server/
RUN cd server && npm install

# Copy client package.json and install deps (cached layer)
COPY client/package*.json ./client/
RUN cd client && npm install

# Copy source code
COPY server/ ./server/
COPY client/ ./client/

# Build the client
RUN cd client && npm run build

# Expose dev port
EXPOSE 3000

# Start server (dev mode with auto-reload)
WORKDIR /app/server
CMD ["npx", "nodemon", "src/index.js"]
