# First-Run Wizard Implementation Plan (v1.6.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When no users exist in the DB, the app shows a setup wizard that creates an admin account, confirms the music library, and optionally configures services (Last.fm, Real-Debrid, VPN, Soulseek). Replaces hardcoded user seeding.

**Architecture:** Express middleware intercepts all requests when `users` table is empty, redirecting to `/api/setup/*` endpoints. The React client renders a `SetupWizard` component instead of the `UserPicker` when the server reports `setup_required`. Existing DB schemas are unchanged — only the seeding/init logic and middleware change.

**Tech Stack:** Node.js, Express, SQLite (better-sqlite3), React

**Spec:** `docs/superpowers/specs/2026-03-23-one-command-setup-design.md` (Part 2: Web First-Run Wizard + Database Integration sections)

---

## File Structure

### Server (new files)
- `packages/server/src/middleware/setup.js` — setup gate middleware
- `packages/server/src/api/setup.js` — setup wizard API endpoints

### Server (modified files)
- `packages/server/src/services/db.js` — remove hardcoded users, add createUser/getUserCount/getDefaultUserId
- `packages/server/src/middleware/user.js` — replace 'default' fallback with getDefaultUserId
- `packages/server/src/index.js` — mount setup routes + middleware, bump version

### Client (new files)
- `packages/client/src/components/SetupWizard.jsx` — full setup wizard UI

### Client (modified files)
- `packages/client/src/App.jsx` — detect setup_required, render wizard instead of UserPicker
- `packages/shared/src/api-client.js` — add setup API functions

### Tests (new files)
- `packages/server/__tests__/api/setup.test.js` — setup endpoint tests
- `packages/server/__tests__/middleware/setup.test.js` — setup gate middleware tests

---

## Phase 1: Database Changes

### Task 1: Add user management functions to db.js

Remove hardcoded user seeding and add proper user creation functions.

**Files:**
- Modify: `packages/server/src/services/db.js`
- Create: `packages/server/__tests__/services/db-users.test.js`

- [ ] **Step 1: Write failing tests for new user functions**

Create `packages/server/__tests__/services/db-users.test.js`:

```javascript
'use strict';

const db = require('../../src/services/db');

describe('user management', () => {
  beforeEach(() => {
    // Clean users table for test isolation
    const d = db.getDb();
    d.prepare("DELETE FROM users").run();
  });

  test('getUserCount returns 0 on empty DB', () => {
    expect(db.getUserCount()).toBe(0);
  });

  test('createUser creates a user with given role', () => {
    const user = db.createUser('testadmin', 'Test Admin', 'admin');
    expect(user).toEqual({ id: 'testadmin', displayName: 'Test Admin', role: 'admin' });
    expect(db.getUserCount()).toBe(1);
    expect(db.isAdmin('testadmin')).toBe(true);
  });

  test('createUser defaults to user role', () => {
    db.createUser('testuser', 'Test User');
    expect(db.isAdmin('testuser')).toBe(false);
  });

  test('getDefaultUserId returns first non-default user', () => {
    expect(db.getDefaultUserId()).toBeNull();
    db.createUser('alice', 'Alice', 'admin');
    db.createUser('bob', 'Bob');
    expect(db.getDefaultUserId()).toBe('alice');
  });

  test('getDefaultUserId skips default user', () => {
    const d = db.getDb();
    d.prepare("INSERT OR IGNORE INTO users (id, display_name) VALUES ('default', 'Default')").run();
    expect(db.getDefaultUserId()).toBeNull(); // only 'default' exists
    db.createUser('real', 'Real User', 'admin');
    expect(db.getDefaultUserId()).toBe('real');
  });

  test('isSetupComplete returns false with no users', () => {
    expect(db.isSetupComplete()).toBe(false);
  });

  test('isSetupComplete returns true when users exist', () => {
    db.createUser('someone', 'Someone', 'admin');
    expect(db.isSetupComplete()).toBe(true);
  });

  test('isSetupComplete returns true when setup_complete flag set', () => {
    db.setGlobalSetting('setup_complete', true);
    expect(db.isSetupComplete()).toBe(true);
    // Clean up
    db.setGlobalSetting('setup_complete', null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest packages/server/__tests__/services/db-users.test.js --no-cache
```

Expected: FAIL — `createUser`, `getUserCount`, `getDefaultUserId`, `isSetupComplete` not exported.

- [ ] **Step 3: Remove hardcoded user seeding from db.js**

In `getDb()` function (around lines 180-190), remove:

```javascript
// REMOVE: auto-promote first user to admin
const hasAdmin = _db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get();
if (!hasAdmin) {
  _db.prepare("UPDATE users SET role = 'admin' WHERE id = (SELECT id FROM users WHERE id != 'default' ORDER BY created_at ASC LIMIT 1)").run();
}

// REMOVE: Seed default users
const upsertUser = _db.prepare('INSERT OR IGNORE INTO users (id, display_name) VALUES (?, ?)');
upsertUser.run('default', 'Default');
upsertUser.run('nathan', 'Nathan');
upsertUser.run('sarah', 'Sarah');
```

Keep the role column migration try/catch (for backward compatibility with DBs created before the role column existed).

- [ ] **Step 4: Add new functions to db.js**

```javascript
function createUser(id, displayName, role = 'user') {
  const db = getDb();
  db.prepare('INSERT INTO users (id, display_name, role) VALUES (?, ?, ?)').run(id, displayName, role);
  return { id, displayName, role };
}

function getUserCount() {
  const db = getDb();
  return db.prepare("SELECT COUNT(*) as count FROM users WHERE id != 'default'").get().count;
}

function getDefaultUserId() {
  const db = getDb();
  const row = db.prepare("SELECT id FROM users WHERE id != 'default' ORDER BY created_at ASC LIMIT 1").get();
  return row?.id || null;
}

function isSetupComplete() {
  try {
    const db = getDb();
    const flag = db.prepare("SELECT value FROM global_settings WHERE key = 'setup_complete'").get();
    if (flag && JSON.parse(flag.value) === true) return true;
    return getUserCount() > 0;
  } catch {
    return false;
  }
}
```

Add all four to `module.exports`.

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx jest packages/server/__tests__/services/db-users.test.js --no-cache
```

Expected: PASS

- [ ] **Step 6: Run full test suite**

```bash
npm test --prefix packages/server
```

Note: Existing tests that rely on hardcoded users may break. The test setup files need to create test users explicitly. Check for failures and fix by adding user creation in test `beforeAll`/`beforeEach` blocks.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/db.js packages/server/__tests__/services/db-users.test.js
git commit -m "feat(db): remove hardcoded users, add createUser/getUserCount/getDefaultUserId/isSetupComplete"
```

---

## Phase 2: Setup Middleware & API

### Task 2: Create setup gate middleware

Intercepts all requests when no users exist. Allows only `/api/health` and `/api/setup/*` through.

**Files:**
- Create: `packages/server/src/middleware/setup.js`
- Create: `packages/server/__tests__/middleware/setup.test.js`

- [ ] **Step 1: Write failing tests**

Create `packages/server/__tests__/middleware/setup.test.js`:

```javascript
'use strict';

const db = require('../../src/services/db');

// Must require after db so we can control state
const setupMiddleware = require('../../src/middleware/setup');

function mockReqRes(path) {
  const req = { path, originalUrl: path };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const next = jest.fn();
  return { req, res, next };
}

describe('setup middleware', () => {
  beforeEach(() => {
    const d = db.getDb();
    d.prepare("DELETE FROM users").run();
    d.prepare("DELETE FROM global_settings WHERE key = 'setup_complete'").run();
    setupMiddleware._resetCache(); // reset cached state
  });

  test('blocks non-setup routes when no users exist', () => {
    const { req, res, next } = mockReqRes('/api/library');
    setupMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'setup_required' }));
  });

  test('allows /api/health through', () => {
    const { req, res, next } = mockReqRes('/api/health');
    setupMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('allows /api/setup/* through', () => {
    const { req, res, next } = mockReqRes('/api/setup/account');
    setupMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('allows all routes when users exist', () => {
    db.createUser('admin1', 'Admin', 'admin');
    setupMiddleware._resetCache();
    const { req, res, next } = mockReqRes('/api/library');
    setupMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('allows all routes when setup_complete flag is set', () => {
    db.setGlobalSetting('setup_complete', true);
    setupMiddleware._resetCache();
    const { req, res, next } = mockReqRes('/api/library');
    setupMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('allows static assets through (non-api)', () => {
    const { req, res, next } = mockReqRes('/index.html');
    setupMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement setup middleware**

Create `packages/server/src/middleware/setup.js`:

```javascript
'use strict';

const db = require('../services/db');

// Cache the setup state — invalidated by _resetCache()
let _setupComplete = null;

function setupMiddleware(req, res, next) {
  // Lazy check — cached after first evaluation
  if (_setupComplete === null) {
    _setupComplete = db.isSetupComplete();
  }

  // If setup is done, pass through everything
  if (_setupComplete) return next();

  // Allow health check, setup endpoints, and static assets
  const path = req.path || req.originalUrl || '';
  if (path === '/api/health' ||
      path.startsWith('/api/setup') ||
      !path.startsWith('/api/')) {
    return next();
  }

  // Block all other API routes
  return res.status(403).json({
    error: 'setup_required',
    setupUrl: '/setup',
    message: 'Please complete the setup wizard to get started.',
  });
}

// Call after creating the first user to update cached state
setupMiddleware._resetCache = function() {
  _setupComplete = null;
};

// Expose for the setup API to invalidate cache after user creation
setupMiddleware._markComplete = function() {
  _setupComplete = true;
};

module.exports = setupMiddleware;
```

- [ ] **Step 3: Run tests**

```bash
npx jest packages/server/__tests__/middleware/setup.test.js --no-cache
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/middleware/setup.js packages/server/__tests__/middleware/setup.test.js
git commit -m "feat(middleware): add setup gate — blocks API when no users exist"
```

---

### Task 3: Create setup API endpoints

**Files:**
- Create: `packages/server/src/api/setup.js`
- Create: `packages/server/__tests__/api/setup.test.js`

- [ ] **Step 1: Write failing tests**

Create `packages/server/__tests__/api/setup.test.js`:

```javascript
'use strict';

const request = require('supertest');
const db = require('../../src/services/db');

// Require app after db init
let app;
beforeAll(() => {
  app = require('../../src/index');
});

describe('Setup API', () => {
  beforeEach(() => {
    const d = db.getDb();
    d.prepare("DELETE FROM users").run();
    d.prepare("DELETE FROM global_settings WHERE key = 'setup_complete'").run();
    // Reset setup middleware cache
    const setupMw = require('../../src/middleware/setup');
    setupMw._resetCache();
  });

  describe('GET /api/setup/status', () => {
    test('returns needsSetup: true when no users', async () => {
      const res = await request(app).get('/api/setup/status');
      expect(res.status).toBe(200);
      expect(res.body.needsSetup).toBe(true);
    });

    test('returns needsSetup: false when users exist', async () => {
      db.createUser('admin1', 'Admin', 'admin');
      const setupMw = require('../../src/middleware/setup');
      setupMw._resetCache();
      const res = await request(app).get('/api/setup/status');
      expect(res.body.needsSetup).toBe(false);
    });
  });

  describe('POST /api/setup/account', () => {
    test('creates admin user', async () => {
      const res = await request(app)
        .post('/api/setup/account')
        .send({ displayName: 'Test Admin' });
      expect(res.status).toBe(201);
      expect(res.body.userId).toBeDefined();
      expect(res.body.isAdmin).toBe(true);
      expect(res.body.displayName).toBe('Test Admin');
    });

    test('rejects when users already exist', async () => {
      db.createUser('existing', 'Existing', 'admin');
      const setupMw = require('../../src/middleware/setup');
      setupMw._resetCache();
      const res = await request(app)
        .post('/api/setup/account')
        .send({ displayName: 'Another' });
      expect(res.status).toBe(409);
    });

    test('rejects missing displayName', async () => {
      const res = await request(app)
        .post('/api/setup/account')
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/setup/library', () => {
    test('returns current music dir info', async () => {
      const res = await request(app).get('/api/setup/library');
      expect(res.status).toBe(200);
      expect(res.body.musicDir).toBeDefined();
    });
  });

  describe('GET /api/setup/services', () => {
    test('returns service status list', async () => {
      const res = await request(app).get('/api/setup/services');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const names = res.body.map(s => s.name);
      expect(names).toContain('lastfm');
      expect(names).toContain('realdebrid');
      expect(names).toContain('soulseek');
    });
  });

  describe('POST /api/setup/complete', () => {
    test('marks setup as complete', async () => {
      db.createUser('admin1', 'Admin', 'admin');
      const res = await request(app).post('/api/setup/complete');
      expect(res.status).toBe(200);
      expect(db.isSetupComplete()).toBe(true);
    });

    test('rejects when no users exist', async () => {
      const res = await request(app).post('/api/setup/complete');
      expect(res.status).toBe(400);
    });
  });
});
```

- [ ] **Step 2: Implement setup API**

Create `packages/server/src/api/setup.js`:

```javascript
'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../services/db');
const setupMiddleware = require('../middleware/setup');

// GET /api/setup/status — check if setup is needed
router.get('/status', (req, res) => {
  const needsSetup = !db.isSetupComplete();
  const userCount = db.getUserCount();
  const completedSteps = [];
  if (userCount > 0) completedSteps.push('account');
  const musicDir = db.getGlobalSetting('musicDir') || process.env.MUSIC_DIR;
  if (musicDir) completedSteps.push('library');
  if (db.getGlobalSetting('setup_complete')) completedSteps.push('complete');
  res.json({ needsSetup, userCount, completedSteps });
});

// POST /api/setup/account — create first admin user
router.post('/account', (req, res) => {
  // Only allowed when no users exist
  if (db.getUserCount() > 0) {
    return res.status(409).json({ error: 'Users already exist. Use Settings to manage users.' });
  }

  const { displayName } = req.body;
  if (!displayName || typeof displayName !== 'string' || displayName.trim().length === 0) {
    return res.status(400).json({ error: 'displayName is required' });
  }

  // Generate a slug-style ID from display name
  const userId = displayName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!userId) {
    return res.status(400).json({ error: 'Could not generate a valid user ID from display name' });
  }

  try {
    const user = db.createUser(userId, displayName.trim(), 'admin');
    setupMiddleware._resetCache();
    res.status(201).json({ userId: user.id, displayName: user.displayName, isAdmin: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to create user: ${err.message}` });
  }
});

// GET /api/setup/library — return music dir info
router.get('/library', (req, res) => {
  const musicDir = db.getGlobalSetting('musicDir') || process.env.MUSIC_DIR || '/app/music';
  let exists = false;
  let writable = false;
  let freeSpace = null;

  try {
    const stat = fs.statSync(musicDir);
    exists = stat.isDirectory();
    // Check writable
    const testFile = path.join(musicDir, `.notify-write-test-${process.pid}`);
    try {
      fs.writeFileSync(testFile, '');
      fs.unlinkSync(testFile);
      writable = true;
    } catch {}
  } catch {}

  res.json({ musicDir, exists, writable, freeSpace });
});

// PUT /api/setup/library — update music dir
router.put('/library', (req, res) => {
  const { musicDir } = req.body;
  if (!musicDir) return res.status(400).json({ error: 'musicDir is required' });

  const resolved = path.resolve(musicDir);
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) return res.status(400).json({ error: 'Not a directory' });
  } catch {
    return res.status(400).json({ error: 'Path does not exist' });
  }

  db.setGlobalSetting('musicDir', resolved);
  res.json({ saved: true, musicDir: resolved });
});

// GET /api/setup/services — return status of all configurable services
router.get('/services', (req, res) => {
  const services = [
    { name: 'lastfm', label: 'Last.fm', configured: false, connected: false },
    { name: 'realdebrid', label: 'Real-Debrid', configured: false, connected: false },
    { name: 'vpn', label: 'VPN (PIA)', configured: false, connected: false },
    { name: 'soulseek', label: 'Soulseek', configured: false, connected: false },
  ];

  // Check Last.fm — look for any user with a session key
  try {
    const d = db.getDb();
    const lfm = d.prepare("SELECT 1 FROM lastfm_config WHERE session_key IS NOT NULL AND session_key != '' LIMIT 1").get();
    if (lfm) {
      services[0].configured = true;
      services[0].connected = true;
    }
  } catch {}

  // Check Real-Debrid
  try {
    const rdToken = db.getGlobalSetting('realDebridToken');
    if (rdToken) {
      services[1].configured = true;
      services[1].connected = true; // we'd need to test, but configured is enough for wizard
    }
  } catch {}

  // Check VPN — stored as vpnConfig object { username, password, region }
  try {
    const vpnConfig = db.getGlobalSetting('vpnConfig');
    if (vpnConfig && vpnConfig.username) {
      services[2].configured = true;
    }
  } catch {}

  // Check Soulseek — stored as soulseekConfig object { username, password }
  try {
    const slskConfig = db.getGlobalSetting('soulseekConfig');
    if (slskConfig && slskConfig.username) {
      services[3].configured = true;
    }
  } catch {}

  res.json(services);
});

// POST /api/setup/service/:name — configure a service (delegates to existing config endpoints)
router.post('/service/:name', async (req, res) => {
  // This is a pass-through that calls the existing service config endpoints
  // so we don't duplicate logic. The setup wizard just needs a unified interface.
  const { name } = req.params;
  const validServices = ['lastfm', 'realdebrid', 'vpn', 'soulseek'];
  if (!validServices.includes(name)) {
    return res.status(400).json({ error: `Unknown service: ${name}` });
  }
  // Return guidance — actual config is done through existing endpoints
  res.json({ message: `Use the existing /api/${name === 'realdebrid' ? 'realdebrid' : name}/config endpoint` });
});

// POST /api/setup/complete — mark setup as done
router.post('/complete', (req, res) => {
  if (db.getUserCount() === 0) {
    return res.status(400).json({ error: 'Cannot complete setup without creating a user' });
  }
  db.setGlobalSetting('setup_complete', true);
  setupMiddleware._markComplete();
  res.json({ complete: true });
});

module.exports = router;
```

- [ ] **Step 3: Run tests**

```bash
npx jest packages/server/__tests__/api/setup.test.js --no-cache
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/api/setup.js packages/server/__tests__/api/setup.test.js
git commit -m "feat(api): add setup wizard endpoints — account creation, library, services, complete"
```

---

### Task 4: Wire up middleware and routes in index.js

**Files:**
- Modify: `packages/server/src/index.js`
- Modify: `packages/server/src/middleware/user.js`

- [ ] **Step 1: Mount setup middleware and routes in index.js**

At the top of the middleware stack (before userMiddleware), add:

```javascript
const setupMiddleware = require('./middleware/setup');
app.use(setupMiddleware);
```

Mount the setup router:

```javascript
const setupRouter = require('./api/setup');
app.use('/api/setup', setupRouter);
```

This must go BEFORE the user middleware and BEFORE admin-guarded routes.

- [ ] **Step 2: Update user middleware fallback**

In `packages/server/src/middleware/user.js`, replace:

```javascript
const userId = req.headers['x-user-id'] || req.query.userId || 'default';
req.userId = db.isValidUser(userId) ? userId : 'default';
```

With:

```javascript
const requestedId = req.headers['x-user-id'] || req.query.userId;
if (requestedId && db.isValidUser(requestedId)) {
  req.userId = requestedId;
} else {
  req.userId = db.getDefaultUserId() || 'default';
}
```

- [ ] **Step 3: Run full test suite**

```bash
npm test --prefix packages/server
```

Fix any tests that break due to missing hardcoded users by adding user creation in their setup.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/index.js packages/server/src/middleware/user.js
git commit -m "feat(server): wire setup middleware and update user fallback"
```

---

## Phase 3: Client Setup Wizard

### Task 5: Add setup API functions to shared api-client

**Files:**
- Modify: `packages/shared/src/api-client.js`

- [ ] **Step 1: Add setup API functions**

```javascript
export async function getSetupStatus() {
  const res = await fetchApi('/setup/status');
  return res.json();
}

export async function createSetupAccount(displayName) {
  const res = await fetchApi('/setup/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName }),
  });
  return res.json();
}

export async function getSetupLibrary() {
  const res = await fetchApi('/setup/library');
  return res.json();
}

export async function updateSetupLibrary(musicDir) {
  const res = await fetchApi('/setup/library', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ musicDir }),
  });
  return res.json();
}

export async function getSetupServices() {
  const res = await fetchApi('/setup/services');
  return res.json();
}

export async function completeSetup() {
  const res = await fetchApi('/setup/complete', { method: 'POST' });
  return res.json();
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/shared/src/api-client.js
git commit -m "feat(api-client): add setup wizard API functions"
```

---

### Task 6: Create SetupWizard React component

**Files:**
- Create: `packages/client/src/components/SetupWizard.jsx`

- [ ] **Step 1: Implement SetupWizard**

**Props interface:**
```javascript
// <SetupWizard onComplete={() => void} />
// onComplete called after "Start Listening" — parent reloads the app
```

**State machine:**
```javascript
const STEPS = ['welcome', 'account', 'library', 'lastfm', 'realdebrid', 'vpn', 'soulseek', 'dashboard'];
const REQUIRED_STEPS = ['welcome', 'account', 'library']; // must complete before optionals
const [step, setStep] = useState('welcome');
const [userData, setUserData] = useState(null);    // { userId, displayName } after account creation
const [libraryInfo, setLibraryInfo] = useState(null); // from GET /api/setup/library
const [services, setServices] = useState([]);       // from GET /api/setup/services
const [showFolderBrowser, setShowFolderBrowser] = useState(false);
```

**Step rendering pattern (each step is a function):**
```jsx
function renderWelcome() {
  return (
    <div>
      <h1>Welcome to Not-ify</h1>
      <p>Let's get you set up. This takes about 2 minutes.</p>
      <button onClick={() => setStep('account')}>Get Started</button>
    </div>
  );
}

function renderAccount() {
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    setSaving(true);
    try {
      const result = await api.createSetupAccount(name);
      setUserData(result);
      // Also fetch library info for next step
      const lib = await api.getSetupLibrary();
      setLibraryInfo(lib);
      setStep('library');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2>Create Your Account</h2>
      <input placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />
      {error && <div style={{ color: COLORS.error }}>{error}</div>}
      <button onClick={handleCreate} disabled={!name.trim() || saving}>
        {saving ? 'Creating...' : 'Continue'}
      </button>
    </div>
  );
}

function renderLibrary() {
  // Shows libraryInfo.musicDir, exists, writable, freeSpace
  // "Looks good" → setStep('lastfm')
  // "Change location" → setShowFolderBrowser(true) → uses <FolderBrowser> component
  // After FolderBrowser selection → api.updateSetupLibrary(path) → update libraryInfo
}

// Optional steps follow same pattern:
function renderOptionalService(name, label, description, ConfigComponent) {
  // "Skip for now" → advance to next step
  // "Configure" → show inline config form (reuse from SettingsModal patterns)
  // "Test Connection" → call existing test endpoint
}

function renderDashboard() {
  // Fetch services: api.getSetupServices()
  // Show green/yellow status for each
  // "Start Listening" → api.completeSetup() → props.onComplete()
}
```

**Layout:** Centered card, 480px max-width, dark background matching app theme. Each step replaces the previous (no sidebar/progress bar — keep it simple).

**Key integration points:**
- `FolderBrowser` imported from `./FolderBrowser.jsx` — same component used in SettingsModal
- Last.fm auth flow: reuse the `lastfmSaveConfig` / `lastfmCompleteAuth` pattern from SettingsModal (lines ~100-180). The wizard calls the same `/api/lastfm/config` and `/api/lastfm/auth/token` endpoints.
- RD config: same as SettingsModal — input field for token, "Save" calls `POST /api/realdebrid/config`, "Test" calls `POST /api/realdebrid/test`
- VPN: same as SettingsModal — username, password, region dropdown from `/api/vpn/regions`, save calls `POST /api/vpn/config`
- Soulseek: same as SettingsModal — username, password, save calls `POST /api/soulseek/config`, test calls `POST /api/soulseek/test`

- [ ] **Step 2: Commit**

```bash
git add packages/client/src/components/SetupWizard.jsx
git commit -m "feat(client): add SetupWizard component — multi-step first-run wizard"
```

---

### Task 7: Wire SetupWizard into App.jsx

**Files:**
- Modify: `packages/client/src/App.jsx`

- [ ] **Step 1: Add setup detection to App**

In the `App` component, before rendering `UserPicker`, check setup status:

```javascript
const [setupRequired, setSetupRequired] = useState(null); // null = loading

useEffect(() => {
  api.getSetupStatus()
    .then(status => setSetupRequired(status.needsSetup))
    .catch(() => setSetupRequired(false)); // assume setup done if can't reach server
}, []);

// Show loading while checking
if (setupRequired === null) return null;

// Show wizard if setup needed
if (setupRequired) {
  return <SetupWizard onComplete={() => {
    setSetupRequired(false);
    window.location.reload();
  }} />;
}

// Existing UserPicker / MainApp flow
if (!currentUser) {
  return <UserPicker ... />;
}
```

- [ ] **Step 2: Handle setup_required responses globally**

In the api-client, add a response interceptor that detects `{ error: 'setup_required' }` and triggers setup mode:

```javascript
// In api-client.js fetchApi wrapper:
if (data.error === 'setup_required') {
  window.dispatchEvent(new Event('notify-setup-required'));
}
```

In App.jsx, listen for this event:

```javascript
useEffect(() => {
  const handler = () => setSetupRequired(true);
  window.addEventListener('notify-setup-required', handler);
  return () => window.removeEventListener('notify-setup-required', handler);
}, []);
```

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/App.jsx packages/shared/src/api-client.js
git commit -m "feat(client): wire SetupWizard into App — detect setup_required, show wizard"
```

---

## Phase 4: Version Bump & Verification

### Task 8: Bump version to 1.6.0

**Files:**
- Modify: `package.json`, `packages/*/package.json`

- [ ] **Step 1: Bump all package versions to 1.6.0**

```bash
node -e "
const fs = require('fs');
['package.json', 'packages/server/package.json', 'packages/client/package.json', 'packages/shared/package.json', 'packages/desktop/package.json'].forEach(f => {
  const pkg = JSON.parse(fs.readFileSync(f, 'utf8'));
  pkg.version = '1.6.0';
  fs.writeFileSync(f, JSON.stringify(pkg, null, 2) + '\n');
});
"
npm install
```

- [ ] **Step 2: Run full test suite**

```bash
npm test --prefix packages/server
```

- [ ] **Step 3: Commit and push**

```bash
git add package.json packages/*/package.json package-lock.json
git commit -m "chore: bump version to 1.6.0 — first-run wizard"
git push origin main
```

---

### Task 9: Manual E2E verification

- [ ] **Step 1: Test fresh DB flow**

```bash
# Back up existing DB
cp config/notify.db config/notify.db.backup

# Delete DB to simulate fresh install
rm config/notify.db

# Start server
npm run dev:server
```

Open http://localhost:3000 — should show the setup wizard, NOT the UserPicker.

- [ ] **Step 2: Walk through wizard**

1. Enter display name → creates admin
2. Verify music library path → confirm
3. Skip optional services
4. Click "Start Listening"
5. App should load normally with your new account

- [ ] **Step 3: Test existing DB backward compatibility**

```bash
# Restore old DB
cp config/notify.db.backup config/notify.db

# Restart server
# Kill and restart dev:server
```

Open http://localhost:3000 — should show UserPicker as before (nathan/sarah). No wizard.

- [ ] **Step 4: Restore and commit any fixes**

---

## Integration Notes

- **Setup middleware caches state** — `_resetCache()` must be called after user creation. The `POST /api/setup/account` endpoint does this.
- **The `default` user** may still exist in old DBs. `getDefaultUserId()` explicitly skips it. `getUserCount()` excludes it.
- **Service configuration in wizard** reuses existing endpoints (Last.fm, RD, VPN, Soulseek config routes). The wizard UI calls the same APIs that Settings does — no duplicate server logic.
- **After wizard completion**, the app behaves identically to the current version. Settings still works, user switching still works, all existing features unchanged.
