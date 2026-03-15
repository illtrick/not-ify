# Notify — Dev Environment Setup

## Architecture Decision: Single Container for MVP

One Node.js container serves both the API server and the web client. Keeps things simple for solo dev, easy to debug, easy to iterate. We can split into multiple containers later if needed.

## Critical WSL2 Rule

**Store the project inside WSL2's Linux filesystem** (e.g., `~/notify/`), NOT on the Windows C: drive. This matters for:
- File watcher performance (nodemon, Vite hot reload)
- inotify events (don't work across the /mnt/c bridge)
- General I/O speed (10-20x faster in Linux filesystem)

You can still edit files from Windows via VS Code's "Remote - WSL" extension. Claude Code and local LLMs access the files via WSL paths.

## Prerequisites
1. WSL2 installed (`wsl --install` in PowerShell Admin → restart)
2. Docker Desktop installed with WSL2 backend enabled
3. Verify: `docker --version` and `docker compose version`

## Project Structure (on WSL2 filesystem)

```
~/notify/
├── docker-compose.yml
├── Dockerfile
├── .dockerignore
│
├── server/              # Headless server application
│   ├── src/
│   │   ├── index.js     # Entry point
│   │   ├── api/         # API routes (search, download, stream, library)
│   │   └── services/    # Business logic (real-debrid, indexer, metadata)
│   └── package.json
│
├── client/              # Web frontend
│   ├── src/
│   │   ├── App.jsx      # Entry point
│   │   ├── pages/
│   │   └── components/
│   └── package.json
│
├── music/               # Downloaded music files (persistent, grows over time)
└── config/              # Database, cache, library index (persistent)
```

## Container Setup

- **Base image:** `node:20-slim` (reliable for npm ecosystem + easy to add ffmpeg)
- **Exposed port:** `3000` — serves both API (`/api/*`) and web client (`/`)
- **Volume mounts:**
  - `./server` → `/app/server` (bind mount, for live reload)
  - `./client` → `/app/client` (bind mount, for live reload)
  - `notify-music` → `/app/music` (named volume for performance)
  - `notify-config` → `/app/config` (named volume for persistence)

## Dev Workflow

1. `docker compose up` starts the container
2. Server runs with nodemon (auto-restarts on file changes)
3. Client runs with Vite dev server (hot module reload)
4. Edit files from Windows via VS Code WSL extension, or from any tool that can access WSL paths
5. Claude Code and local LLMs read/write directly to the WSL filesystem

## What Gets Installed in the Container
- Node.js 20
- ffmpeg (for audio format handling if needed)
- npm dependencies for server and client

## Next Steps After Container Is Running
1. Scaffold the server API (search, download, stream endpoints)
2. Scaffold the client (search bar, player controls)
3. Wire up Real-Debrid API
4. Wire up a music indexer
5. Get the full loop working: search → find → download → play
