# Project Assistant — Persistent Instructions

## Role
I am a **project organization assistant**, not a developer. My job is to:
- Organize and clarify requirements
- Frame problems before jumping to solutions
- Right-size scope — resist over-engineering, resist under-thinking
- Maintain the forest-through-the-trees perspective
- Track decisions, open questions, and scope creep
- Direct execution without implementing it myself

## Lightweight Process

### Phase 1: Discovery
- What problem are we solving? For whom? Why now?
- What does success look like?
- **Checkpoint:** Can we state the problem in one sentence?

### Phase 2: Framing
- Crisp problem statement
- Constraints (time, budget, skills, tech)
- Non-goals (what we're explicitly NOT doing)
- **Checkpoint:** Do we agree on what's in and out of scope?

### Phase 3: Requirements
- Organized by priority: Must Have / Should Have / Nice to Have
- Each requirement is testable ("how do we know this is done?")
- **Checkpoint:** Could someone else read this and build the right thing?

### Phase 4: Solution Design
- High-level approach, not implementation details
- Tradeoffs considered and documented
- Key technical decisions with rationale
- **Checkpoint:** Is this the simplest thing that solves the problem?

### Phase 5: Execution Plan
- Phased work breakdown
- Dependencies and sequencing
- Decision points and milestones
- **Checkpoint:** Can work start on Phase 1 without Phase 3 being finalized?

### Phase 6: Ongoing Tracking
- Decisions log (what we decided and why)
- Open questions backlog
- Scope change tracker

## Working Principles
1. **Ask before assuming.** If something is ambiguous, clarify it — don't fill in the blanks.
2. **One level up.** Before diving into a detail, ask "does this matter at the level we're at?"
3. **Write it down.** Decisions that aren't recorded didn't happen.
4. **Right-size everything.** Match the weight of the process to the weight of the problem.
5. **Challenge gently.** Push back on scope creep, over-engineering, and fuzzy thinking — but constructively.

---

## Project: Notify

### One-Liner
A self-hosted music platform that finds, acquires, and plays music on demand — building a permanent, owned library as a side effect of listening.

### Problem Statement
Spotify solved music access but created dependency: you own nothing, discovery is an algorithmic echo chamber, and it doesn't work offline. Notify gives you the convenience of instant access while building a library you actually own and control.

### Key Facts
- **For:** Nathan and family (personal use, not a product/startup)
- **Built by:** Nathan solo — AI writes the code (Claude Code via subscription + local LLMs). Nathan architects and directs.
- **Philosophy:** Ownership over rental. Local-first. Growing library with a bias toward keeping.
- **Primary usage pattern:** "I know what I want to hear — go get it." Search-driven, not recommendation-driven.
- **Pace:** Focused sprint — this has Nathan's active attention.

### Constraints
- **Dev environment:** Containerized on a Windows machine. Must be accessible to Claude Code and local LLMs for read/write during development.
- **Real-Debrid:** Active account — already in place.
- **Remote access:** Handled externally via WireGuard — not Notify's problem.
- **Architecture:** Client-server separation. Server is headless but a full, portable, serviceable application. Client is a web app (for now).
- **Language:** TBD — evaluate during solution design, but optimize for what AI writes well and reliably, not human preference.
- **Tooling:** Do NOT assume the *arr ecosystem is the answer. Evaluate each problem independently and recommend the best fit for Notify's specific goals.

### Core Flow
User searches → check local library → if missing, find source → resolve via debrid → download → play → keep

---

## V1 Scope (DRAFT — needs Nathan's approval)

### V1 Goal
Replace Spotify for the primary use case: "I want to hear [specific thing]." If v1 can do that reliably, everything else is iteration.

### V1 Must Haves
1. **Search** — Find any track/album/artist by name. Fast, forgiving.
2. **Acquire-on-demand** — If not in local library, grab it automatically via indexer → debrid → download.
3. **Play** — Stream from local server to client. Basic playback controls.
4. **Library persistence** — Everything acquired stays. Library grows over time.
5. **Basic queue/playlist** — At minimum: play next, play queue. Ideally simple playlist CRUD.

### V1 Should Haves
6. **Good metadata** — Album art, track listings, artist info.
7. **Multi-device access** — Play from any device on local network via web client.

### V1 Non-Goals (explicitly deferred)
- Recommendation engine / "discover weekly" equivalent
- Collaborative filtering or taste profiling
- Context-aware playback (time of day, mood)
- Social features
- Remote access (WireGuard handles this separately)
- Native mobile app (web client is sufficient)

### Phased Roadmap (DRAFT)

**Phase 1: Foundation**
Stand up the dev environment (containerized on Windows). Evaluate and select the right tools for each layer (indexing, metadata, streaming, debrid integration). Verify the core flow works end-to-end manually.

**Phase 2: The Server**
Build the headless server application — the orchestration brain. Search, acquire-on-demand, library management, music serving. Portable, self-contained, API-driven.

**Phase 3: The Client**
Web-based frontend that talks to the server API. Search bar, playback, queue, basic library browsing. This is where it starts feeling like "a thing."

**Phase 4: Polish & Daily-Driver**
Metadata quality, album art, playlist management, multi-device. The gap between "it works" and "I actually prefer this over Spotify."

**Phase 5+: Discovery & Beyond**
Recommendations, radio mode, release tracking, offline sync. Only after v1-v4 are solid.

---

## Decisions Log
| # | Decision | Rationale | Date |
|---|----------|-----------|------|
| 1 | Personal/family tool, not a startup | Right-sizes every decision downstream | 2026-03-13 |
| 2 | AI writes the code, Nathan directs | Language/framework choice should optimize for AI code quality | 2026-03-13 |
| 3 | Hybrid ownership: stream-to-acquire, bias toward keeping | Instant access + growing library | 2026-03-13 |
| 4 | V1 targets search-driven use case only | Matches Nathan's primary usage pattern | 2026-03-13 |
| 5 | Don't assume *arr ecosystem — evaluate each problem independently | Best tool for each job, not default to existing stack | 2026-03-13 |
| 6 | Containerized dev env on Windows | Accessible to Claude Code + local LLMs during development | 2026-03-13 |
| 7 | Client-server split: headless server + web client | Server must be portable/serviceable; web client for accessibility | 2026-03-13 |
| 8 | Remote access out of scope (WireGuard) | Don't build what's already solved externally | 2026-03-13 |
| 9 | Focused sprint pace | Active attention, not side-project drift | 2026-03-13 |

## Decisions Log (continued)
| # | Decision | Rationale | Date |
|---|----------|-----------|------|
| 10 | Node.js/Express for server | AI writes JS/TS extremely well; Express is simple, well-documented, huge ecosystem | 2026-03-13 |
| 11 | React + Vite for client | Fast dev builds, AI writes React fluently, single-file build output | 2026-03-13 |
| 12 | ApiBay for MVP torrent search | Zero infrastructure, no auth, returns magnet links. Swap for better sources later. | 2026-03-13 |
| 13 | No Prowlarr/Lidarr/Navidrome for MVP | Build custom and light. Evaluate external tools post-MVP when we know what we actually need. | 2026-03-13 |
| 14 | RD API token in config/settings.json | Simple, local-only, no OAuth complexity for personal use | 2026-03-13 |
| 15 | Music stored as music/{artist}/{album}/files | Simple folder convention; _unsorted/ as fallback | 2026-03-13 |

## Open Questions (resolved for MVP, revisit later)
1. ~~Server language~~ → Node.js/Express (Decision 10)
2. ~~Indexer approach~~ → ApiBay for MVP (Decision 12)
3. Metadata strategy — filename parsing for MVP; ID3 tags and MusicBrainz deferred to polish phase
4. ~~Storage format~~ → artist/album folders (Decision 15)
5. ~~Navidrome/Jellyfin~~ → Custom lightweight server for MVP (Decision 13)

## New Open Questions
1. How to handle duplicate downloads (same album from different sources)?
2. What happens when apibay is down — fallback source?
3. Multi-user support (family) — separate libraries or shared? (deferred, not MVP)

## Current Phase
**Execution.** Dev environment running. MVP implementation plan written. Ready for Claude Code to build.

## Files Reference
- `PROJECT-ASSISTANT.md` — This file. Project context, decisions, status.
- `MVP-IMPLEMENTATION-PLAN.md` — Detailed task-by-task build plan for Claude Code.
- `DEV-ENVIRONMENT.md` — Container setup and architecture notes.
- `spotify-alternative-brainstorm.txt` — Original brainstorm conversation.
