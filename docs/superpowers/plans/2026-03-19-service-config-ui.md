# Service Configuration UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin-only settings UI for Real-Debrid and VPN (PIA) credentials with connection testing, stored in SQLite global_settings.

**Architecture:** Extend existing scrollable SettingsModal with collapsible sections. Admin-only sections (RD, VPN) hidden for non-admin users. Server stores credentials in `global_settings` table (already exists). Each service has a dedicated API route file with config CRUD + test endpoint. RD service reads token from DB instead of file. VPN test hits an IP-check API through the configured proxy.

**Tech Stack:** React (client), Express (server), better-sqlite3, existing COLORS/Icon system.

**Key files reference:**
- `packages/server/src/services/db.js` — `getGlobalSetting(key)`, `setGlobalSetting(key, value)` already exist
- `packages/server/src/services/realdebrid.js` — currently reads token from `config/settings.json` (must change to DB)
- `packages/client/src/components/SettingsModal.jsx` — current settings UI (125 lines, Playback + Last.fm only)
- `packages/server/src/middleware/user.js` — sets `req.userId`, no admin check yet
- `packages/server/src/services/db.js` — `users` table has `id`, `display_name`, `created_at` — no role column
- `packages/client/src/components/UserPicker.jsx` — `getCurrentUser()` returns a **string** (user ID), not an object
- `packages/client/src/App.jsx` — `currentUser` state is a string; passed as `currentUser={currentUser}` to Sidebar

**Important context for implementers:**
- `currentUser` in App.jsx is a **string** (user ID like `'nathan'`), NOT an object. Do not assume it has `.role`.
- VPN passwords are stored as plaintext JSON in SQLite `global_settings`. Acceptable for a home-network app.
- `rdFetch()` in realdebrid.js calls `getToken()` on every request — no changes needed to `rdFetch` itself.
- API client methods in `packages/shared/src/api-client.js` are thin wrappers around `get()`/`post()` — no unit tests needed, covered by E2E in Task 10.

---

### Task 1: Add admin role to users table

**Files:**
- Modify: `packages/server/src/services/db.js`
- Test: `packages/server/__tests__/services/admin-role.test.js`

The users table needs a `role` column. Nathan = admin, Sarah = user. The admin check will be used to gate config endpoints and hide UI sections.

- [ ] **Step 1: Write failing test**

```javascript
// packages/server/__tests__/services/admin-role.test.js
const db = require('../../src/services/db');

afterAll(() => db.close());

describe('admin role', () => {
  test('isAdmin returns true for admin user', () => {
    db.getDb().prepare("INSERT OR REPLACE INTO users (id, display_name, role) VALUES (?, ?, ?)").run('test-admin', 'Admin', 'admin');
    expect(db.isAdmin('test-admin')).toBe(true);
  });

  test('isAdmin returns false for regular user', () => {
    db.getDb().prepare("INSERT OR REPLACE INTO users (id, display_name, role) VALUES (?, ?, ?)").run('test-user', 'User', 'user');
    expect(db.isAdmin('test-user')).toBe(false);
  });

  test('isAdmin returns false for unknown user', () => {
    expect(db.isAdmin('nonexistent')).toBe(false);
  });

  test('getUsers includes role field', () => {
    const users = db.getUsers();
    const admin = users.find(u => u.id === 'test-admin');
    expect(admin).toBeDefined();
    expect(admin.role).toBe('admin');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPatterns="admin-role" --no-coverage`
Expected: FAIL — `role` column doesn't exist, `isAdmin` not defined

- [ ] **Step 3: Implement admin role**

In `packages/server/src/services/db.js`:

1. Add `role` column to CREATE TABLE (with default 'user'):
```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at INTEGER DEFAULT (unixepoch())
);
```

2. Add ALTER TABLE migration for existing DBs (right after the `_db.exec(...)` block):
```javascript
// Migration: add role column if missing
try {
  _db.prepare("SELECT role FROM users LIMIT 1").get();
} catch {
  _db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
}
// Auto-promote first user to admin if no admins exist
const hasAdmin = _db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get();
if (!hasAdmin) {
  _db.prepare("UPDATE users SET role = 'admin' WHERE id = (SELECT id FROM users WHERE id != 'default' ORDER BY created_at ASC LIMIT 1)").run();
}
```

3. Add `isAdmin` function:
```javascript
function isAdmin(userId) {
  const db = getDb();
  const row = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
  return row?.role === 'admin';
}
```

4. Update `getUsers` to include role:
```javascript
function getUsers() {
  const db = getDb();
  return db.prepare("SELECT id, display_name as displayName, role FROM users WHERE id != 'default' ORDER BY display_name").all();
}
```

5. Export `isAdmin`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --testPathPatterns="admin-role" --no-coverage`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/db.js packages/server/__tests__/services/admin-role.test.js
git commit -m "feat: add admin role to users table with auto-promotion"
```

---

### Task 2: Admin guard middleware

**Files:**
- Create: `packages/server/src/middleware/admin.js`
- Test: `packages/server/__tests__/middleware/admin.test.js`

Simple middleware: check `db.isAdmin(req.userId)`, return 403 if not. Created early so it's available when we mount config routes.

- [ ] **Step 1: Write failing test**

```javascript
// packages/server/__tests__/middleware/admin.test.js
const express = require('express');
const request = require('supertest');
const db = require('../../src/services/db');
const adminGuard = require('../../src/middleware/admin');

const app = express();
app.use((req, res, next) => { req.userId = req.headers['x-user-id'] || 'default'; next(); });
app.get('/admin-only', adminGuard, (req, res) => res.json({ ok: true }));

afterAll(() => db.close());

describe('admin middleware', () => {
  beforeAll(() => {
    db.getDb().prepare("INSERT OR REPLACE INTO users (id, display_name, role) VALUES (?, ?, ?)").run('adm', 'Admin', 'admin');
    db.getDb().prepare("INSERT OR REPLACE INTO users (id, display_name, role) VALUES (?, ?, ?)").run('usr', 'User', 'user');
  });

  test('allows admin users', () => {
    return request(app).get('/admin-only').set('X-User-Id', 'adm').expect(200);
  });

  test('blocks non-admin users with 403', () => {
    return request(app).get('/admin-only').set('X-User-Id', 'usr').expect(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPatterns="admin.test" --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Create admin middleware**

```javascript
// packages/server/src/middleware/admin.js
const db = require('../services/db');

function adminGuard(req, res, next) {
  if (!db.isAdmin(req.userId)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = adminGuard;
```

- [ ] **Step 4: Run tests**

Run: `npx jest --testPathPatterns="admin.test" --no-coverage`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/middleware/admin.js packages/server/__tests__/middleware/admin.test.js
git commit -m "feat: admin guard middleware for config endpoints"
```

---

### Task 3: Real-Debrid config API + DB migration

**Files:**
- Create: `packages/server/src/api/realdebrid-config.js`
- Modify: `packages/server/src/services/realdebrid.js` — read token from DB instead of file
- Modify: `packages/server/src/index.js` — mount new routes with admin guard
- Test: `packages/server/__tests__/api/realdebrid-config.test.js`

Three endpoints: GET status, POST config (save token), POST test (verify token works). All gated by adminGuard.

- [ ] **Step 1: Write failing test**

```javascript
// packages/server/__tests__/api/realdebrid-config.test.js
const express = require('express');
const request = require('supertest');
const db = require('../../src/services/db');

jest.mock('../../src/services/realdebrid', () => ({
  getUserInfo: jest.fn(),
  setToken: jest.fn(),
}));

const rd = require('../../src/services/realdebrid');
const rdConfigRouter = require('../../src/api/realdebrid-config');

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.userId = 'test-admin'; next(); });
app.use('/api/realdebrid', rdConfigRouter);

afterAll(() => db.close());

describe('Real-Debrid config API', () => {
  test('GET /status returns not_configured when no token', () => {
    return request(app).get('/api/realdebrid/status')
      .expect(200)
      .then(res => {
        expect(res.body.configured).toBe(false);
      });
  });

  test('POST /config saves token', () => {
    return request(app).post('/api/realdebrid/config')
      .send({ apiToken: 'test-token-123' })
      .expect(200)
      .then(res => {
        expect(res.body.saved).toBe(true);
      });
  });

  test('GET /status returns configured after save, never exposes full token', () => {
    return request(app).get('/api/realdebrid/status')
      .expect(200)
      .then(res => {
        expect(res.body.configured).toBe(true);
        expect(res.body.token).toBeUndefined();
        expect(res.body.tokenPreview).toMatch(/^test-t\.\.\.123$/);
      });
  });

  test('POST /test calls getUserInfo and returns user info', async () => {
    rd.getUserInfo.mockResolvedValue({
      username: 'testuser', email: 'test@test.com',
      type: 'premium', premium: 1, expiration: '2026-08-15T00:00:00.000Z',
    });
    const res = await request(app).post('/api/realdebrid/test').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.user.username).toBe('testuser');
  });

  test('POST /test returns error on failure', async () => {
    rd.getUserInfo.mockRejectedValue(new Error('Invalid token'));
    const res = await request(app).post('/api/realdebrid/test').expect(200);
    expect(res.body.status).toBe('error');
    expect(res.body.error).toContain('Invalid token');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPatterns="realdebrid-config" --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Create realdebrid-config.js route**

```javascript
// packages/server/src/api/realdebrid-config.js
const express = require('express');
const router = express.Router();
const db = require('../services/db');
const rd = require('../services/realdebrid');

// GET /api/realdebrid/status
router.get('/status', (req, res) => {
  const token = db.getGlobalSetting('realDebridToken');
  res.json({
    configured: !!token,
    tokenPreview: token ? `${token.slice(0, 6)}...${token.slice(-4)}` : null,
  });
});

// POST /api/realdebrid/config — save token
router.post('/config', (req, res) => {
  const { apiToken } = req.body;
  if (!apiToken) return res.status(400).json({ error: 'Missing apiToken' });
  db.setGlobalSetting('realDebridToken', apiToken);
  rd.setToken(apiToken);
  res.json({ saved: true });
});

// POST /api/realdebrid/test — verify token works
router.post('/test', async (req, res) => {
  try {
    const user = await rd.getUserInfo();
    res.json({
      status: 'ok',
      user: {
        username: user.username, email: user.email,
        type: user.type, premium: user.premium, expiration: user.expiration,
      },
    });
  } catch (err) {
    res.json({ status: 'error', error: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 4: Modify realdebrid.js to read from DB**

Replace `getToken()` in `packages/server/src/services/realdebrid.js`. Keep the existing `fs` + `CONFIG_PATH` imports for legacy fallback. Add `require('./db')`. The existing `rdFetch()` calls `getToken()` on every request — no changes needed to `rdFetch`.

```javascript
const db = require('./db');

let _cachedToken = null;

function getToken() {
  if (_cachedToken) return _cachedToken;
  // Try DB first (new path)
  const dbToken = db.getGlobalSetting('realDebridToken');
  if (dbToken && dbToken !== 'USER_PUTS_TOKEN_HERE') {
    _cachedToken = dbToken;
    return dbToken;
  }
  // Fallback: legacy config/settings.json
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    const token = config.realDebrid?.apiToken;
    if (token && token !== 'USER_PUTS_TOKEN_HERE') {
      db.setGlobalSetting('realDebridToken', token); // migrate to DB
      _cachedToken = token;
      return token;
    }
  } catch {}
  throw new Error('Real-Debrid API token not configured');
}

function setToken(token) {
  _cachedToken = token;
}
```

Add `setToken` to module.exports.

- [ ] **Step 5: Mount routes in index.js with admin guard**

Add to `packages/server/src/index.js`:
```javascript
const adminGuard = require('./middleware/admin');
const rdConfigRouter = require('./api/realdebrid-config');
app.use('/api/realdebrid', adminGuard, rdConfigRouter);
```

Remove the old `/api/test/rd-status` route (replaced by `/api/realdebrid/test`).

- [ ] **Step 6: Run tests**

Run: `npx jest --testPathPatterns="realdebrid-config" --no-coverage`
Expected: PASS (5 tests)

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/api/realdebrid-config.js packages/server/src/services/realdebrid.js packages/server/src/index.js packages/server/__tests__/api/realdebrid-config.test.js
git commit -m "feat: Real-Debrid config API with DB storage and test endpoint"
```

---

### Task 4: VPN config API

**Files:**
- Create: `packages/server/src/api/vpn-config.js`
- Test: `packages/server/__tests__/api/vpn-config.test.js`
- Modify: `packages/server/src/index.js` — mount routes with admin guard

Three endpoints: GET status (explicit destructuring — never leak password), POST config, POST test, GET regions.

- [ ] **Step 1: Write failing test**

```javascript
// packages/server/__tests__/api/vpn-config.test.js
const express = require('express');
const request = require('supertest');
const db = require('../../src/services/db');

const vpnConfigRouter = require('../../src/api/vpn-config');

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.userId = 'test-admin'; next(); });
app.use('/api/vpn', vpnConfigRouter);

afterAll(() => db.close());

describe('VPN config API', () => {
  test('GET /status returns not configured initially', () => {
    return request(app).get('/api/vpn/status')
      .expect(200)
      .then(res => {
        expect(res.body.configured).toBe(false);
      });
  });

  test('POST /config saves credentials and region', () => {
    return request(app).post('/api/vpn/config')
      .send({ username: 'piauser', password: 'piapass', region: 'US East' })
      .expect(200)
      .then(res => {
        expect(res.body.saved).toBe(true);
      });
  });

  test('GET /status shows configured after save, never exposes password', () => {
    return request(app).get('/api/vpn/status')
      .expect(200)
      .then(res => {
        expect(res.body.configured).toBe(true);
        expect(res.body.region).toBe('US East');
        expect(res.body.username).toBe('piauser');
        expect(res.body.password).toBeUndefined();
      });
  });

  test('GET /regions returns PIA region list', () => {
    return request(app).get('/api/vpn/regions')
      .expect(200)
      .then(res => {
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(5);
        expect(res.body).toContain('US East');
      });
  });

  test('POST /test returns proxy_unavailable in dev (no VPN_PROXY env)', async () => {
    const res = await request(app).post('/api/vpn/test').expect(200);
    expect(res.body.status).toBe('proxy_unavailable');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPatterns="vpn-config" --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Create vpn-config.js route**

```javascript
// packages/server/src/api/vpn-config.js
const express = require('express');
const router = express.Router();
const db = require('../services/db');

// Common PIA regions (source: PIA server list, March 2026)
const PIA_REGIONS = [
  'US East', 'US West', 'US California', 'US Chicago', 'US Denver',
  'US Florida', 'US Houston', 'US Las Vegas', 'US New York', 'US Seattle',
  'US Silicon Valley', 'US Washington DC', 'US Atlanta',
  'CA Montreal', 'CA Ontario', 'CA Toronto', 'CA Vancouver',
  'UK London', 'UK Manchester', 'UK Southampton',
  'DE Berlin', 'DE Frankfurt',
  'Netherlands', 'Switzerland', 'Sweden', 'Norway', 'Denmark', 'Finland',
  'France', 'Belgium', 'Austria', 'Czech Republic', 'Poland', 'Romania',
  'Spain', 'Italy', 'Ireland', 'Iceland',
  'AU Melbourne', 'AU Sydney', 'AU Perth',
  'Japan', 'Singapore', 'Hong Kong', 'Israel', 'India',
  'Brazil', 'Argentina', 'Mexico',
];

router.get('/regions', (req, res) => {
  res.json(PIA_REGIONS);
});

router.get('/status', (req, res) => {
  const config = db.getGlobalSetting('vpnConfig');
  if (!config) return res.json({ configured: false });
  // Explicit destructuring — never leak password
  const { username, region } = config;
  res.json({ configured: true, username, region });
});

router.post('/config', (req, res) => {
  const { username, password, region } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing username or password' });
  db.setGlobalSetting('vpnConfig', { username, password, region: region || 'US East' });
  res.json({ saved: true });
});

router.post('/test', async (req, res) => {
  const proxyUrl = process.env.VPN_PROXY;
  if (!proxyUrl) {
    return res.json({ status: 'proxy_unavailable', message: 'VPN proxy not available (dev mode — no gluetun sidecar)' });
  }
  try {
    const { ProxyAgent } = require('undici');
    const agent = new ProxyAgent(proxyUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch('https://api.ipify.org?format=json', {
      dispatcher: agent,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await response.json();
    const config = db.getGlobalSetting('vpnConfig');
    const region = config?.region || 'unknown';
    res.json({ status: 'ok', ip: data.ip, region, message: `Connected via ${data.ip} (${region})` });
  } catch (err) {
    res.json({ status: 'error', error: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 4: Mount routes in index.js with admin guard**

Add to `packages/server/src/index.js` (after the RD routes from Task 3):
```javascript
const vpnConfigRouter = require('./api/vpn-config');
app.use('/api/vpn', adminGuard, vpnConfigRouter);
```

- [ ] **Step 5: Run tests**

Run: `npx jest --testPathPatterns="vpn-config" --no-coverage`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/api/vpn-config.js packages/server/src/index.js packages/server/__tests__/api/vpn-config.test.js
git commit -m "feat: VPN config API with PIA regions and proxy test endpoint"
```

---

### Task 5: API client methods

**Files:**
- Modify: `packages/shared/src/api-client.js`

Thin wrappers — no unit tests needed, covered by E2E verification in Task 10.

- [ ] **Step 1: Add methods**

```javascript
// Real-Debrid config
export function getRdStatus() { return get('/api/realdebrid/status'); }
export function saveRdConfig(body) { return post('/api/realdebrid/config', body); }
export function testRdConnection() { return post('/api/realdebrid/test'); }

// VPN config
export function getVpnStatus() { return get('/api/vpn/status'); }
export function getVpnRegions() { return get('/api/vpn/regions'); }
export function saveVpnConfig(body) { return post('/api/vpn/config', body); }
export function testVpnConnection() { return post('/api/vpn/test'); }
```

- [ ] **Step 2: Commit**

```bash
git add packages/shared/src/api-client.js
git commit -m "feat: add RD and VPN config API client methods"
```

---

### Task 6: Expose user role to client

**Files:**
- Modify: `packages/client/src/components/UserPicker.jsx`
- Modify: `packages/client/src/App.jsx`

**Critical context:** `currentUser` in App.jsx is a **string** (user ID). The `/api/users` endpoint now returns `role` (from Task 1). We need to make `isAdmin` available in App.jsx WITHOUT changing `currentUser` from string to object (that would break everything that passes it as a userId).

Approach: Fetch the user list on login, look up the current user's role, store `isAdmin` as a separate boolean.

- [ ] **Step 1: Modify UserPicker to pass full user object**

In `packages/client/src/components/UserPicker.jsx`, change `onUserSelected` to pass the full user object instead of just the ID. The UserPicker already fetches users via API and has the role data.

Find the click handler (around line 22) that calls:
```javascript
onUserSelected(user.id);
```

Keep storing just the ID in localStorage (for backwards compatibility), but pass the full object to the callback:
```javascript
localStorage.setItem(USER_KEY, user.id);
onUserSelected(user);  // pass full { id, displayName, role }
```

Also update `getCurrentUser()` — it returns just the ID string, which is fine. We need a separate function or approach for the role.

- [ ] **Step 2: Modify App.jsx to track isAdmin**

In `packages/client/src/App.jsx`:

Change the `onUserSelected` handler (around line 55):
```javascript
// Before:
return <UserPicker onUserSelected={(userId) => setCurrentUser(userId)} />;

// After:
return <UserPicker onUserSelected={(user) => {
  setCurrentUser(user.id);
  setIsAdmin(user.role === 'admin');
  api.setUser(user.id);
}} />;
```

Add state:
```javascript
const [isAdmin, setIsAdmin] = useState(false);
```

For the initial load (when `getCurrentUser()` returns a saved ID from localStorage), we need to fetch the role. Add to the initial effect (around line 348):
```javascript
// Fetch current user's role for admin gating
api.getUsers?.().then(users => {
  const me = users?.find(u => u.id === currentUser);
  if (me) setIsAdmin(me.role === 'admin');
}).catch(() => {});
```

Note: `getUsers` should already exist in api-client. If not, add:
```javascript
export function getUsers() { return get('/api/users'); }
```

- [ ] **Step 3: Verify isAdmin flows correctly**

Add temporary `console.log('isAdmin:', isAdmin)` in App.jsx. Start dev servers, log in as Nathan — should log `true`. Log in as Sarah — should log `false`. Remove the console.log.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/components/UserPicker.jsx packages/client/src/App.jsx packages/shared/src/api-client.js
git commit -m "feat: expose user admin role to client for UI gating"
```

---

### Task 7: useServiceConfig hook

**Files:**
- Create: `packages/client/src/hooks/useServiceConfig.js`

Generic hook that manages load/save/test flow for any service config. Avoids duplicating state logic for RD and VPN.

- [ ] **Step 1: Create hook**

```javascript
// packages/client/src/hooks/useServiceConfig.js
import { useState, useEffect, useCallback } from 'react';

/**
 * Generic hook for service config: load status, save config, test connection.
 * @param {object} opts
 * @param {Function} opts.getStatus  — async () => { configured, ...details }
 * @param {Function} opts.saveConfig — async (fields) => { saved }
 * @param {Function} opts.testConn   — async () => { status, ...result }
 * @param {boolean}  opts.enabled    — whether to load (false for non-admin)
 */
export function useServiceConfig({ getStatus, saveConfig, testConn, enabled = true }) {
  const [status, setStatus] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const data = await getStatus();
      setStatus(data);
    } catch (err) {
      setError(err.message);
    }
  }, [getStatus, enabled]);

  useEffect(() => { load(); }, [load]);

  async function save(fields) {
    if (saving) return false;
    setSaving(true);
    setError(null);
    try {
      await saveConfig(fields);
      await load();
      setSaving(false);
      return true;
    } catch (err) {
      setError(err.message);
      setSaving(false);
      return false;
    }
  }

  async function test() {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const result = await testConn();
      setTestResult(result);
    } catch (err) {
      setTestResult({ status: 'error', error: err.message });
    } finally {
      setTesting(false);
    }
  }

  return { status, testResult, testing, saving, error, save, test, reload: load };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/client/src/hooks/useServiceConfig.js
git commit -m "feat: generic useServiceConfig hook for config load/save/test"
```

---

### Task 8: Settings UI — Real-Debrid + VPN sections

**Files:**
- Modify: `packages/client/src/components/SettingsModal.jsx`
- Modify: `packages/client/src/App.jsx` — pass isAdmin, rdConfig, vpnConfig, vpnRegions

Add both service sections to SettingsModal in one task. Both follow the same pattern: status dot, input fields, Save button, Test Connection button, inline results.

- [ ] **Step 1: Add new props and StatusDot to SettingsModal**

New props: `isAdmin`, `rdConfig`, `vpnConfig`, `vpnRegions`.

Add `StatusDot` helper at the top of SettingsModal (inside the file, before the export):
```jsx
function StatusDot({ status }) {
  const color = status === 'ok' ? COLORS.success : status === 'error' ? COLORS.error : COLORS.textSecondary;
  return <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />;
}
```

- [ ] **Step 2: Add Real-Debrid section**

After the Last.fm section (before the closing `</div>` of the modal), add the RD section. Only render when `isAdmin && rdConfig`:

- Section header with "Real-Debrid" + StatusDot (green if `rdConfig.status?.configured`)
- Password-type input for API token
- Local state: `const [rdToken, setRdToken] = useState('')`
- "Save" button → `rdConfig.save({ apiToken: rdToken })`
- "Test Connection" button → `rdConfig.test()`
- Test result display:
  - `rdConfig.testResult?.status === 'ok'` → green text: "Premium — {username}, expires {expiration}"
  - `rdConfig.testResult?.status === 'error'` → red text: error message
- If already configured, show `rdConfig.status.tokenPreview` as placeholder

- [ ] **Step 3: Add VPN section**

Below the RD section. Only render when `isAdmin && vpnConfig`:

- Section header with "VPN (PIA)" + StatusDot
- Username input, password input (type=password)
- Region `<select>` dropdown populated from `vpnRegions` array
- Local state: `vpnUser`, `vpnPass`, `vpnRegion` — pre-fill from `vpnConfig.status` if configured
- "Save" button → `vpnConfig.save({ username: vpnUser, password: vpnPass, region: vpnRegion })`
- "Test Connection" button → `vpnConfig.test()`
- Test result display:
  - `status === 'ok'` → green: "Connected via {ip} ({region})"
  - `status === 'proxy_unavailable'` → gray (not red): "VPN proxy not available (dev mode)"
  - `status === 'error'` → red: error message

- [ ] **Step 4: Wire up in App.jsx**

```javascript
import { useServiceConfig } from './hooks/useServiceConfig';

// Inside App component, after currentUser/isAdmin:
const rdConfig = useServiceConfig({
  getStatus: api.getRdStatus,
  saveConfig: api.saveRdConfig,
  testConn: api.testRdConnection,
  enabled: isAdmin,
});

const vpnConfig = useServiceConfig({
  getStatus: api.getVpnStatus,
  saveConfig: api.saveVpnConfig,
  testConn: api.testVpnConnection,
  enabled: isAdmin,
});

const [vpnRegions, setVpnRegions] = useState([]);
useEffect(() => {
  if (isAdmin) api.getVpnRegions().then(setVpnRegions).catch(() => {});
}, [isAdmin]);
```

Pass `isAdmin`, `rdConfig`, `vpnConfig`, `vpnRegions` to SettingsModal.

- [ ] **Step 5: Verify in preview**

Start dev servers, log in as Nathan, open Settings:
- See Playback, Last.fm, Real-Debrid, VPN sections
- RD: paste token, Save, Test Connection → should hit server
- VPN: enter creds + region, Save, Test → "proxy not available (dev mode)"

Log in as Sarah → only see Playback and Last.fm.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/components/SettingsModal.jsx packages/client/src/App.jsx
git commit -m "feat: Real-Debrid + VPN config UI in settings (admin only)"
```

---

### Task 9: Version bump and changelog

**Files:**
- Modify: all 5 `package.json` files — bump to 1.1.1
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Run full test suite**

Run: `npx jest --no-coverage`
Expected: All server tests pass (ignore client JSX parse failures — pre-existing Babel config issue)

- [ ] **Step 2: Bump version and update changelog**

Update all 5 `package.json` to `1.1.1`.

Add to CHANGELOG.md above the `[1.1.0]` entry:

```markdown
## [1.1.1] - 2026-03-19

### Added
- Admin role system: first user auto-promoted to admin, role column on users table
- Real-Debrid config UI with token input and connection testing (admin only)
- VPN (PIA) config UI with region selector and proxy connectivity test (admin only)
- Admin guard middleware for sensitive config endpoints
- Generic `useServiceConfig` hook for service config load/save/test pattern

### Changed
- Real-Debrid token storage migrated from config/settings.json to SQLite global_settings
- Settings modal now shows service sections based on user role
- VPN credentials stored in SQLite (plaintext — acceptable for home network)
```

- [ ] **Step 3: Commit**

```bash
git add package.json packages/server/package.json packages/client/package.json packages/shared/package.json packages/desktop/package.json CHANGELOG.md
git commit -m "v1.1.1: Service config UI — Real-Debrid + VPN settings with admin roles"
```
