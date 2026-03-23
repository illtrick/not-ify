import React, { useState, useEffect } from 'react';
import { COLORS } from '../constants';
import { FolderBrowser } from './FolderBrowser';
import {
  createSetupAccount,
  getSetupLibrary,
  updateSetupLibrary,
  getSetupServices,
  completeSetup,
  lastfmSaveConfig as apiLastfmSaveConfig,
  lastfmGetAuthToken,
  lastfmCompleteAuth as apiLastfmCompleteAuth,
  saveRdConfig,
  testRdConnection,
  saveVpnConfig,
  testVpnConnection,
  getVpnRegions,
  saveSlskConfig,
  testSlskConnection,
} from '@not-ify/shared';

// ---------------------------------------------------------------------------
// Shared style helpers
// ---------------------------------------------------------------------------
const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: 6,
  border: `1px solid ${COLORS.border}`, background: COLORS.hover,
  color: COLORS.textPrimary, fontSize: 14, outline: 'none',
  boxSizing: 'border-box',
};

const btnPrimary = {
  padding: '10px 24px', borderRadius: 8, border: 'none',
  background: COLORS.accent, color: '#fff',
  fontSize: 14, fontWeight: 600, cursor: 'pointer',
};

const btnSecondary = {
  padding: '10px 20px', borderRadius: 8, border: `1px solid ${COLORS.border}`,
  background: COLORS.hover, color: COLORS.textPrimary,
  fontSize: 14, cursor: 'pointer',
};

const btnSmall = {
  padding: '7px 14px', borderRadius: 6, border: 'none',
  background: COLORS.accent, color: '#fff',
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
};

const btnSmallSecondary = {
  padding: '7px 14px', borderRadius: 6, border: `1px solid ${COLORS.border}`,
  background: COLORS.hover, color: COLORS.textPrimary,
  fontSize: 13, cursor: 'pointer',
};

function StatusDot({ ok }) {
  return (
    <span style={{
      width: 8, height: 8, borderRadius: '50%',
      background: ok ? COLORS.success : COLORS.border,
      display: 'inline-block', flexShrink: 0,
    }} />
  );
}

// ---------------------------------------------------------------------------
// Step: Welcome
// ---------------------------------------------------------------------------
function StepWelcome({ onNext }) {
  return (
    <div style={{ textAlign: 'center', padding: '20px 0' }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>🎵</div>
      <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: COLORS.textPrimary }}>
        Welcome to Not-ify
      </h2>
      <p style={{ fontSize: 15, color: COLORS.textSecondary, marginBottom: 32, lineHeight: 1.6 }}>
        Let's get your music server set up. This only takes a minute.
      </p>
      <button style={btnPrimary} onClick={onNext}>Get Started</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step: Account
// ---------------------------------------------------------------------------
function StepAccount({ onNext }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      await createSetupAccount(trimmed);
      onNext();
    } catch (err) {
      setError(err.body?.error || err.message || 'Failed to create account');
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSubmit();
  };

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: COLORS.textPrimary }}>
        Create your account
      </h2>
      <p style={{ fontSize: 14, color: COLORS.textSecondary, marginBottom: 24, lineHeight: 1.6 }}>
        Choose a display name. You can add more users later in settings.
      </p>
      <div style={{ marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Display name"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          style={inputStyle}
          autoFocus
        />
      </div>
      {error && <div style={{ color: COLORS.error, fontSize: 13, marginBottom: 12 }}>{error}</div>}
      <button
        style={{ ...btnPrimary, opacity: !name.trim() || saving ? 0.5 : 1, cursor: !name.trim() || saving ? 'default' : 'pointer' }}
        onClick={handleSubmit}
        disabled={!name.trim() || saving}
      >
        {saving ? 'Creating…' : 'Continue'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step: Library
// ---------------------------------------------------------------------------
function StepLibrary({ onNext }) {
  const [library, setLibrary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showBrowser, setShowBrowser] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadLibrary = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getSetupLibrary();
      setLibrary(data);
    } catch (err) {
      setError(err.body?.error || err.message || 'Failed to load library info');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadLibrary(); }, []);

  const handlePathSelected = async (path) => {
    setShowBrowser(false);
    setSaving(true);
    setError(null);
    try {
      const data = await updateSetupLibrary(path);
      setLibrary(data);
    } catch (err) {
      setError(err.body?.error || err.message || 'Failed to update music directory');
    } finally {
      setSaving(false);
    }
  };

  if (showBrowser) {
    return (
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16, color: COLORS.textPrimary }}>
          Choose music folder
        </h2>
        <FolderBrowser
          initialPath={library?.musicDir || '/'}
          onSelect={handlePathSelected}
          onCancel={() => setShowBrowser(false)}
        />
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: COLORS.textPrimary }}>
        Music library
      </h2>
      <p style={{ fontSize: 14, color: COLORS.textSecondary, marginBottom: 24, lineHeight: 1.6 }}>
        Where are your music files stored on the server?
      </p>

      {loading ? (
        <div style={{ color: COLORS.textSecondary, fontSize: 14, marginBottom: 24 }}>Loading…</div>
      ) : error ? (
        <div style={{ color: COLORS.error, fontSize: 13, marginBottom: 16 }}>{error}</div>
      ) : library ? (
        <div style={{
          padding: '14px 16px', borderRadius: 8, background: COLORS.hover,
          border: `1px solid ${COLORS.border}`, marginBottom: 16,
        }}>
          <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 4 }}>Music directory</div>
          <div style={{ fontSize: 14, color: COLORS.textPrimary, fontFamily: 'monospace', wordBreak: 'break-all', marginBottom: 8 }}>
            {library.musicDir || 'Not set'}
          </div>
          {library.exists && library.writable && library.musicDir === '/app/music' && (
            <div style={{ fontSize: 12, color: COLORS.success, marginBottom: 4 }}>
              Configured during setup — ready to use
            </div>
          )}
          {library.freeSpaceGB != null && (
            <div style={{ fontSize: 12, color: COLORS.textSecondary }}>
              {library.freeSpaceGB} GB free
              {library.valid === false && (
                <span style={{ color: COLORS.error, marginLeft: 8 }}>Directory not found</span>
              )}
            </div>
          )}
        </div>
      ) : null}

      {error && <div style={{ color: COLORS.error, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button style={btnPrimary} onClick={onNext} disabled={saving}>
          Looks good
        </button>
        <button style={btnSecondary} onClick={() => setShowBrowser(true)} disabled={saving || loading}>
          Change
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline service config forms
// ---------------------------------------------------------------------------

function LastfmForm({ onDone }) {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [authStep, setAuthStep] = useState(0);
  const [authUrl, setAuthUrl] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleConnect = async () => {
    if (!apiKey || !apiSecret) return;
    setSaving(true);
    setError(null);
    try {
      await apiLastfmSaveConfig({ apiKey, apiSecret });
      const tokenData = await lastfmGetAuthToken();
      if (tokenData.error) throw new Error(tokenData.error);
      setAuthToken(tokenData.token);
      setAuthUrl(tokenData.authUrl);
      setAuthStep(1);
    } catch (err) {
      setError(err.body?.error || err.message || 'Failed to connect');
    } finally {
      setSaving(false);
    }
  };

  const handleCompleteAuth = async () => {
    setSaving(true);
    setError(null);
    try {
      const data = await apiLastfmCompleteAuth(authToken);
      if (data.error) throw new Error(data.error);
      onDone();
    } catch (err) {
      setError(err.body?.error || err.message || 'Authorization failed — did you approve access on Last.fm?');
    } finally {
      setSaving(false);
    }
  };

  if (authStep === 1) {
    return (
      <div>
        <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 12 }}>
          Authorize Not-ify on Last.fm, then click "I've Authorized" below.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a
            href={authUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...btnSmall, background: '#d51007', textDecoration: 'none', display: 'inline-block' }}
          >
            Open Last.fm
          </a>
          <button style={btnSmallSecondary} onClick={handleCompleteAuth} disabled={saving}>
            {saving ? 'Checking…' : "I've Authorized"}
          </button>
        </div>
        {error && <div style={{ color: COLORS.error, fontSize: 12, marginTop: 8 }}>{error}</div>}
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 10 }}>
        <a
          href="https://www.last.fm/api/account/create"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: COLORS.accent }}
        >
          Get API key
        </a>
        {' '}from Last.fm, then paste your credentials below.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
        <input type="text" placeholder="API Key" value={apiKey} onChange={e => setApiKey(e.target.value)} style={inputStyle} />
        <input type="text" placeholder="Shared Secret" value={apiSecret} onChange={e => setApiSecret(e.target.value)} style={inputStyle} />
      </div>
      <button
        style={{ ...btnSmall, opacity: (!apiKey || !apiSecret || saving) ? 0.5 : 1 }}
        onClick={handleConnect}
        disabled={!apiKey || !apiSecret || saving}
      >
        {saving ? 'Connecting…' : 'Connect'}
      </button>
      {error && <div style={{ color: COLORS.error, fontSize: 12, marginTop: 8 }}>{error}</div>}
    </div>
  );
}

function RdForm({ onDone }) {
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState(null);

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    setError(null);
    try {
      await saveRdConfig({ apiToken: token });
      onDone();
    } catch (err) {
      setError(err.body?.error || err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testRdConnection();
      setTestResult(result);
    } catch (err) {
      setTestResult({ status: 'error', error: err.body?.error || err.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <input
        type="password"
        placeholder="Real-Debrid API token"
        value={token}
        onChange={e => setToken(e.target.value)}
        style={{ ...inputStyle, marginBottom: 10 }}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button style={{ ...btnSmall, opacity: (!token || saving) ? 0.5 : 1 }} onClick={handleSave} disabled={!token || saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button style={btnSmallSecondary} onClick={handleTest} disabled={testing}>
          {testing ? 'Testing…' : 'Test Connection'}
        </button>
      </div>
      {error && <div style={{ color: COLORS.error, fontSize: 12, marginTop: 8 }}>{error}</div>}
      {testResult && (
        <div style={{ fontSize: 12, marginTop: 8, color: testResult.status === 'ok' ? COLORS.success : COLORS.error }}>
          {testResult.status === 'ok'
            ? `Premium — ${testResult.user?.username || 'connected'}`
            : testResult.error}
        </div>
      )}
    </div>
  );
}

function VpnForm({ onDone }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [region, setRegion] = useState('US East');
  const [regions, setRegions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getVpnRegions().then(data => setRegions(data.regions || data || [])).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveVpnConfig({ username, password, region });
      onDone();
    } catch (err) {
      setError(err.body?.error || err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testVpnConnection();
      setTestResult(result);
    } catch (err) {
      setTestResult({ status: 'error', error: err.body?.error || err.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
        <input type="text" placeholder="PIA username" value={username} onChange={e => setUsername(e.target.value)} style={inputStyle} />
        <input type="password" placeholder="PIA password" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle} />
        <select value={region} onChange={e => setRegion(e.target.value)} style={inputStyle}>
          <option value="">Select region…</option>
          {regions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button style={{ ...btnSmall, opacity: saving ? 0.5 : 1 }} onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button style={btnSmallSecondary} onClick={handleTest} disabled={testing}>
          {testing ? 'Testing…' : 'Test Connection'}
        </button>
      </div>
      {error && <div style={{ color: COLORS.error, fontSize: 12, marginTop: 8 }}>{error}</div>}
      {testResult && (
        <div style={{ fontSize: 12, marginTop: 8, color: testResult.status === 'ok' ? COLORS.success : COLORS.error }}>
          {testResult.status === 'ok' ? 'VPN connected' : testResult.error}
        </div>
      )}
    </div>
  );
}

function SlskForm({ onDone }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveSlskConfig({ username, password });
      onDone();
    } catch (err) {
      setError(err.body?.error || err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testSlskConnection();
      setTestResult(result);
    } catch (err) {
      setTestResult({ status: 'error', error: err.body?.error || err.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
        <input type="text" placeholder="Soulseek username" value={username} onChange={e => setUsername(e.target.value)} style={inputStyle} />
        <input type="password" placeholder="Soulseek password" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button style={{ ...btnSmall, opacity: saving ? 0.5 : 1 }} onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button style={btnSmallSecondary} onClick={handleTest} disabled={testing}>
          {testing ? 'Testing…' : 'Test Connection'}
        </button>
      </div>
      {error && <div style={{ color: COLORS.error, fontSize: 12, marginTop: 8 }}>{error}</div>}
      {testResult && (
        <div style={{ fontSize: 12, marginTop: 8, color: testResult.status === 'ok' ? COLORS.success : COLORS.error }}>
          {testResult.status === 'ok' ? 'Connected to Soulseek' : testResult.error}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step: Services
// ---------------------------------------------------------------------------
const SERVICE_DEFS = [
  {
    id: 'lastfm',
    name: 'Last.fm',
    description: 'Scrobble tracks and get personalized recommendations.',
    FormComponent: LastfmForm,
  },
  {
    id: 'realdebrid',
    name: 'Real-Debrid',
    description: 'Premium download links for high-quality music acquisition.',
    FormComponent: RdForm,
  },
  {
    id: 'vpn',
    name: 'VPN (PIA)',
    description: 'Route Soulseek traffic through a VPN for privacy.',
    FormComponent: VpnForm,
  },
  {
    id: 'soulseek',
    name: 'Soulseek',
    description: 'Peer-to-peer music discovery and downloads.',
    FormComponent: SlskForm,
  },
];

function StepServices({ onNext }) {
  const [services, setServices] = useState({});
  const [configured, setConfigured] = useState({});
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    getSetupServices()
      .then(data => setServices(data || {}))
      .catch(() => {});
  }, []);

  const handleConfigured = (id) => {
    setConfigured(prev => ({ ...prev, [id]: true }));
    setExpanded(null);
  };

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: COLORS.textPrimary }}>
        Connect services
      </h2>
      <p style={{ fontSize: 14, color: COLORS.textSecondary, marginBottom: 20, lineHeight: 1.6 }}>
        These are optional — you can configure them now or any time in Settings.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
        {SERVICE_DEFS.map(({ id, name, description, FormComponent }) => {
          const isConfigured = configured[id] || services[id]?.configured;
          const isExpanded = expanded === id;

          return (
            <div key={id} style={{
              borderRadius: 8, border: `1px solid ${isExpanded ? COLORS.accent : COLORS.border}`,
              background: COLORS.hover, overflow: 'hidden',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
              }}>
                <StatusDot ok={isConfigured} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary }}>{name}</div>
                  <div style={{ fontSize: 12, color: COLORS.textSecondary }}>{description}</div>
                </div>
                {isExpanded ? (
                  <button style={btnSmallSecondary} onClick={() => setExpanded(null)}>
                    Collapse
                  </button>
                ) : (
                  <button style={isConfigured ? btnSmallSecondary : btnSmall} onClick={() => setExpanded(id)}>
                    {isConfigured ? 'Reconfigure' : 'Configure'}
                  </button>
                )}
              </div>
              {isExpanded && (
                <div style={{ padding: '0 16px 16px' }}>
                  <FormComponent onDone={() => handleConfigured(id)} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button style={btnPrimary} onClick={onNext}>
          Continue
        </button>
        <button style={btnSecondary} onClick={onNext}>
          Skip all, finish setup
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step: Dashboard (summary + finish)
// ---------------------------------------------------------------------------
function StepDashboard({ onComplete }) {
  const [services, setServices] = useState(null);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    getSetupServices()
      .then(data => {
        // API returns array — convert to object keyed by name for easy lookup
        const map = {};
        (Array.isArray(data) ? data : []).forEach(s => { map[s.name] = s; });
        setServices(map);
      })
      .catch(() => setServices({}));
  }, []);

  const handleFinish = async () => {
    setCompleting(true);
    setError(null);
    try {
      await completeSetup();
      onComplete();
    } catch (err) {
      setError(err.body?.error || err.message || 'Failed to complete setup');
      setCompleting(false);
    }
  };

  const SERVICE_LABELS = {
    lastfm: 'Last.fm',
    realdebrid: 'Real-Debrid',
    vpn: 'VPN',
    soulseek: 'Soulseek',
  };

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: COLORS.textPrimary }}>
        All set!
      </h2>
      <p style={{ fontSize: 14, color: COLORS.textSecondary, marginBottom: 20, lineHeight: 1.6 }}>
        Here's a summary of your configuration:
      </p>

      {services && (
        <div style={{
          padding: '14px 16px', borderRadius: 8, background: COLORS.hover,
          border: `1px solid ${COLORS.border}`, marginBottom: 24,
        }}>
          {Object.entries(SERVICE_LABELS).map(([id, label]) => (
            <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
              <StatusDot ok={services[id]?.configured} />
              <span style={{ fontSize: 14, color: services[id]?.configured ? COLORS.textPrimary : COLORS.textSecondary }}>
                {label}
              </span>
              <span style={{ fontSize: 12, color: COLORS.textSecondary, marginLeft: 'auto' }}>
                {services[id]?.configured ? 'Configured' : 'Not configured'}
              </span>
            </div>
          ))}
        </div>
      )}

      {error && <div style={{ color: COLORS.error, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <button style={{ ...btnPrimary, opacity: completing ? 0.6 : 1 }} onClick={handleFinish} disabled={completing}>
        {completing ? 'Starting…' : 'Start Listening'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SetupWizard — top-level orchestrator
// ---------------------------------------------------------------------------
const STEPS = ['welcome', 'account', 'library', 'services', 'dashboard'];

export function SetupWizard({ onComplete }) {
  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx];

  const next = () => setStepIdx(i => Math.min(i + 1, STEPS.length - 1));

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: COLORS.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
    }}>
      <div style={{
        width: '100%', maxWidth: 520,
        background: COLORS.surface, borderRadius: 16,
        padding: 36,
        boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
        boxSizing: 'border-box',
      }}>
        {/* Progress dots */}
        {step !== 'welcome' && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 28 }}>
            {STEPS.filter(s => s !== 'welcome').map((s, i) => {
              const currentNonWelcomeIdx = STEPS.indexOf(step) - 1;
              const done = i < currentNonWelcomeIdx;
              const active = i === currentNonWelcomeIdx;
              return (
                <div key={s} style={{
                  height: 3, flex: 1, borderRadius: 2,
                  background: done ? COLORS.accent : active ? COLORS.accent : COLORS.border,
                  opacity: done ? 1 : active ? 1 : 0.4,
                  transition: 'background 0.3s',
                }} />
              );
            })}
          </div>
        )}

        {step === 'welcome' && <StepWelcome onNext={next} />}
        {step === 'account' && <StepAccount onNext={next} />}
        {step === 'library' && <StepLibrary onNext={next} />}
        {step === 'services' && <StepServices onNext={next} />}
        {step === 'dashboard' && <StepDashboard onComplete={onComplete} />}
      </div>
    </div>
  );
}
