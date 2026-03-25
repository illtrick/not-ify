# UX Requirements: Setup Hardening + Multi-VPN Provider

---

## CLI: Bootstrap Script — VPN Setup Flow

### Context
User has just selected optional services and enabled VPN. They're still in the SSH terminal on their NAS.

### Flow

```
  ╔═══════════════════════════════════════╗
  ║  VPN Provider                         ║
  ╚═══════════════════════════════════════╝

  Not-ify routes torrent downloads through a VPN
  for privacy. Choose your VPN provider below.

  Providers:
    [1] Private Internet Access (PIA)
    [2] NordVPN
    [3] Mullvad
    [4] Surfshark
    [5] ProtonVPN
    [6] ExpressVPN
    [7] Windscribe
    [8] CyberGhost
    [9] IVPN
    [10] TorGuard
    [11] Other (enter gluetun provider name)
    [S] Skip — configure later in Settings

  Select: [S] _
```

**If user selects a provider (1-10):**

```
  ✓ Selected: Private Internet Access (PIA)

  Enter your PIA credentials:
  Username: _
  Password: _

  Region: [US East] _

  Testing connection...
  ✓ VPN connected — IP: 154.16.105.102 (Las Vegas, US)
```

**If connection test fails:**

```
  ✗ VPN connection failed after 30s

  This could mean:
  • Incorrect username or password
  • Your VPN subscription has expired
  • The region is unavailable

    [1] Re-enter credentials
    [2] Skip — configure later in Settings
    [3] Quit setup

  Select: _
```

**If user selects "Other" (11):**

```
  Enter gluetun provider name exactly as shown at:
  https://github.com/qdm12/gluetun-wiki

  Provider name: _
  Username: _
  Password: _
  Region (leave blank for default): _
```

**If user selects "Skip" (S):**

```
  ▸ VPN skipped — you can configure it anytime in Settings.
    Torrent downloads will use your regular internet connection
    until VPN is configured.
```

### Requirements
- Provider list shows the 10 most popular VPN services
- "Other" option for the remaining 14+ gluetun-supported providers
- "Skip" is the default (pressing Enter skips) — VPN is optional
- Password input should be masked (show dots or nothing)
- Connection test runs after credentials are entered (30s timeout)
- On test failure, user gets 3 clear options — retry, skip, or quit
- Region shows a sensible default per provider (US-based)
- If user has no VPN subscription, they shouldn't feel blocked

---

## CLI: Bootstrap Script — Soulseek Setup Flow

### Context
Soulseek is always installed (part of the core setup). The question is whether the user has credentials to connect to the network.

### Flow

```
  ╔═══════════════════════════════════════╗
  ║  Soulseek                             ║
  ╚═══════════════════════════════════════╝

  Soulseek connects you to a peer-to-peer music
  sharing network for finding lossless audio files.

  Do you have a Soulseek account?
    [1] Yes — enter my credentials
    [2] No — I'll create one later
    [3] What is Soulseek?

  Select: [2] _
```

**If user selects "Yes" (1):**

```
  Soulseek username: _
  Soulseek password: _

  Testing connection...
  ✓ Connected to Soulseek as musicfan99
```

**If connection test fails:**

```
  ✗ Could not connect to Soulseek

  This could mean:
  • Incorrect username or password
  • Soulseek servers are temporarily down

    [1] Re-enter credentials
    [2] Skip — configure later in Settings

  Select: _
```

**If user selects "No" (2):**

```
  ▸ Soulseek skipped — Not-ify will search torrents for
    upgrades. You can add Soulseek credentials anytime
    in Settings.

    To create a free account, visit:
    https://www.slsknet.org/news/node/1
```

**If user selects "What is Soulseek?" (3):**

```
  Soulseek is a peer-to-peer file sharing network
  popular with music enthusiasts. It's one of the best
  sources for finding lossless (FLAC) versions of albums.

  It's free to use. Create an account at:
  https://www.slsknet.org/news/node/1

  Do you have a Soulseek account?
    [1] Yes — enter my credentials
    [2] No — I'll create one later

  Select: _
```

### Requirements
- Default is "No" (pressing Enter skips) — most users won't have Soulseek
- "What is Soulseek?" gives a brief, non-technical explanation
- If skipped, slskd starts in API-only mode (no network connection attempt, no error logs)
- Password input should be masked
- Connection test verifies credentials against the Soulseek network (15s timeout)
- On failure, offer retry or skip — never block setup

---

## Web UI: Settings — VPN Section

### Current State (broken)
- Hardcoded to "PIA" with username/password/region
- Saves to DB only, doesn't update gluetun
- No feedback on whether gluetun actually connected

### New Design

```
┌─────────────────────────────────────────────┐
│  VPN  ● (green if connected, red if not)    │
│                                             │
│  Connected via NordVPN — US East            │
│  Public IP: 154.16.105.102                  │
│                                             │
│  Provider    [NordVPN           ▾]          │
│  Username    [user@email.com    ]           │
│  Password    [••••••••••••      ] 👁        │
│  Region      [United States     ▾]          │
│                                             │
│  [Save]  [Test Connection]                  │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ Saving... Updating VPN config...    │    │
│  │ ████████████░░░░░░ Restarting...    │    │
│  │ ✓ VPN connected (3.2s)             │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  Don't have a VPN? Not-ify works without    │
│  one — torrent downloads will use your      │
│  regular connection. [Disconnect VPN]       │
│                                             │
└─────────────────────────────────────────────┘
```

### States

**Not configured:**
```
│  VPN  ○                                     │
│                                             │
│  No VPN configured. Torrent downloads       │
│  use your regular internet connection.      │
│                                             │
│  Provider    [Select provider...  ▾]        │
```

**Saving + restarting:**
```
│  VPN  ◌ (spinning)                          │
│                                             │
│  Applying changes...                        │
│  ████████████░░░░░░ Restarting VPN...       │
│                                             │
│  (all fields disabled during restart)       │
```

**Connected:**
```
│  VPN  ● (green)                             │
│                                             │
│  Connected via PIA — US Las Vegas           │
│  Public IP: 154.16.105.102                  │
```

**Failed:**
```
│  VPN  ● (red)                               │
│                                             │
│  VPN failed to connect                      │
│  Check your credentials and try again.      │
│                                             │
│  Last error: Authentication failed          │
```

### Behavior Requirements

1. **Provider dropdown** loads from `/api/vpn/providers`. Shows 10 curated providers + "Other".
2. **Region dropdown** updates dynamically when provider changes. Shows curated list of 5-10 popular regions per provider.
3. **Save** does 4 things in sequence:
   a. Saves to not-ify DB
   b. Updates `.env` file on disk
   c. Restarts gluetun container via Docker socket
   d. Polls gluetun health for up to 30s
4. **Progress indicator** shows each step: "Saving..." → "Restarting VPN..." → "Connecting..." → "✓ Connected" or "✗ Failed"
5. **Test Connection** checks gluetun status + does an IP lookup to show public IP and location.
6. **Disconnect VPN** option stops gluetun and removes VPN_PROXY from not-ify env.
7. **Fields are disabled** during save/restart to prevent double-submit.
8. **Error messages** are specific: "Authentication failed" vs "Region unavailable" vs "Provider not responding".
9. If Docker socket is not available (dev mode), show a warning: "Container restart not available in dev mode. Restart gluetun manually."

---

## Web UI: Settings — Soulseek Section

### Current State (partially broken)
- Shows username + password fields
- Pushes to slskd API on save
- Does NOT persist to .env — creds lost on container restart

### New Design

```
┌─────────────────────────────────────────────┐
│  Soulseek  ● (green if connected)           │
│                                             │
│  Connected as unselfishtoast                │
│                                             │
│  Username    [unselfishtoast    ] 👁        │
│  Password    [Enter new password] 👁        │
│                                             │
│  [Save]  [Test Connection]                  │
│                                             │
│  Don't have an account?                     │
│  Create one free at slsknet.org             │
│                                             │
└─────────────────────────────────────────────┘
```

### States

**Not configured:**
```
│  Soulseek  ○                                │
│                                             │
│  Not connected. Soulseek is a peer-to-peer  │
│  network for finding lossless music files.  │
│                                             │
│  Username    [                  ]            │
│  Password    [                  ]            │
│                                             │
│  [Save]                                     │
│                                             │
│  Don't have an account?                     │
│  Create one free at slsknet.org             │
```

**Saving:**
```
│  Soulseek  ◌ (spinning)                     │
│                                             │
│  Saving... Connecting to Soulseek...        │
│  ████████████████░░░░                       │
```

**Connected:**
```
│  Soulseek  ● (green)                        │
│                                             │
│  Connected as unselfishtoast                │
```

**Failed:**
```
│  Soulseek  ● (red)                          │
│                                             │
│  Could not connect to Soulseek              │
│  Check your credentials and try again.      │
```

### Behavior Requirements

1. **Save** does 3 things in sequence:
   a. Saves to not-ify DB
   b. Updates `.env` file (SLSKD_SLSK_USERNAME, SLSKD_SLSK_PASSWORD)
   c. Pushes to slskd API (`PATCH /api/v0/options`)
   d. If API push fails, restarts slskd container via Docker socket
2. **Password field** shows "Enter new password" placeholder when creds exist. Submitting empty password keeps existing.
3. **Test Connection** checks slskd server status via API, shows "Connected as {username}" or error.
4. **Username is pre-filled** from saved config (already implemented).
5. **Link to slsknet.org** for account creation.

---

## Web UI: Settings — Container Status Dashboard

### New Addition (bottom of Settings)

```
┌─────────────────────────────────────────────┐
│  Services                                   │
│                                             │
│  ● not-ify     v1.6.6    Running (healthy)  │
│  ● slskd       v0.24.5   Running            │
│  ● gluetun     latest    Running (VPN up)   │
│  ● clamav      stable    Running (healthy)  │
│  ● watchtower  latest    Running            │
│                                             │
│  [Restart All]                              │
└─────────────────────────────────────────────┘
```

### Requirements

1. Shows all 5 containers with status
2. Status colors: green = running/healthy, yellow = starting, red = stopped/unhealthy
3. Version shown where available (from container labels or API)
4. **Restart All** restarts all containers in sequence (not-ify last since it serves the UI)
5. Individual container restart via right-click or three-dot menu (admin only)
6. Auto-refreshes every 30s
7. Only visible to admin users

---

## General UX Principles

1. **Never block the user.** VPN and Soulseek are optional. The app works without them — just with fewer upgrade sources.
2. **Always show progress.** Container restarts take 5-30s. Show a progress bar or spinner with step descriptions.
3. **Test after save.** Every credential save should auto-test the connection and show the result.
4. **Persist everything.** If the user configured it in the UI, it must survive container restarts, watchtower upgrades, and server reboots.
5. **Fail with clear messages.** "Authentication failed" not "Error 401". "Region unavailable" not "Connection timed out".
6. **Default to skip.** In the CLI, pressing Enter should skip optional services. The user can always configure later in the UI.
7. **Mask passwords.** Both CLI and UI. CLI uses `read -s` or equivalent. UI uses password input type with show/hide toggle.
