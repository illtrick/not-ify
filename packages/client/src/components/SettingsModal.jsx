import React, { useState, useEffect } from 'react';
import { COLORS } from '../constants';
import { Icon } from './Icon';
import { importFromLastfm, switchVpnRegion } from '@not-ify/shared';

function StatusDot({ status }) {
  const color = status === 'ok' ? COLORS.success : status === 'error' ? COLORS.error : COLORS.textSecondary;
  return <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block', marginLeft: 6 }} />;
}

export function SettingsModal({
  showSettings, setShowSettings,
  crossfadeDuration, setCrossfadeDuration,
  lastfmStatus,
  lastfmApiKey, setLastfmApiKey,
  lastfmApiSecret, setLastfmApiSecret,
  lastfmAuthStep,
  lastfmAuthUrl,
  lastfmError,
  lastfmSaveConfig,
  lastfmCompleteAuth,
  lastfmDisconnect,
  isAdmin,
  rdConfig,
  vpnConfig,
  vpnRegions,
  syncStatus,
  onSyncNow,
}) {
  const [rdToken, setRdToken] = useState('');
  const [vpnUser, setVpnUser] = useState('');
  const [vpnPass, setVpnPass] = useState('');
  const [vpnRegion, setVpnRegion] = useState('US East');

  // Last.fm library import state
  const [importDays, setImportDays] = useState(60);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const handleImport = async () => {
    setImporting(true);
    setImportResult(null);
    try {
      const result = await importFromLastfm(importDays);
      setImportResult(result);
    } catch (err) {
      setImportResult({ error: err.message });
    } finally {
      setImporting(false);
    }
  };

  // Sync VPN fields when status loads
  useEffect(() => {
    if (vpnConfig?.status) {
      if (vpnConfig.status.username) setVpnUser(vpnConfig.status.username);
      if (vpnConfig.status.region) setVpnRegion(vpnConfig.status.region);
    }
  }, [vpnConfig?.status]);

  if (!showSettings) return null;

  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: 6,
    border: `1px solid ${COLORS.border}`, background: COLORS.hover,
    color: COLORS.textPrimary, fontSize: 14, outline: 'none', boxSizing: 'border-box',
  };

  const sectionStyle = { marginBottom: 24 };

  const sectionHeaderStyle = {
    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
  };

  const sectionTitleStyle = { fontSize: 15, fontWeight: 600 };

  const buttonPrimaryStyle = {
    padding: '8px 16px', borderRadius: 6, border: 'none',
    background: COLORS.accent, color: '#fff',
    fontSize: 13, fontWeight: 600, cursor: 'pointer',
  };

  const buttonSecondaryStyle = {
    padding: '8px 16px', borderRadius: 6, border: `1px solid ${COLORS.border}`,
    background: COLORS.hover, color: COLORS.textPrimary,
    fontSize: 13, cursor: 'pointer',
  };

  const buttonDisabledStyle = {
    ...buttonSecondaryStyle,
    opacity: 0.5, cursor: 'default',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={() => setShowSettings(false)}>
      <div style={{ background: COLORS.surface, borderRadius: 12, padding: 28, width: 420, maxWidth: '90vw', boxShadow: '0 12px 40px rgba(0,0,0,0.6)', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontSize: 18, fontWeight: 700 }}>Settings</span>
          <button onClick={() => setShowSettings(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            {Icon.close(18, COLORS.textSecondary)}
          </button>
        </div>

        {/* Playback section */}
        <div style={sectionStyle}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Playback</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, color: COLORS.textPrimary }}>Crossfade</div>
              <div style={{ fontSize: 11, color: COLORS.textSecondary }}>Smooth transition between tracks</div>
            </div>
            <select
              value={crossfadeDuration}
              onChange={e => setCrossfadeDuration(parseInt(e.target.value, 10))}
              style={{
                padding: '6px 10px', borderRadius: 6, border: `1px solid ${COLORS.border}`,
                background: COLORS.hover, color: COLORS.textPrimary, fontSize: 13, cursor: 'pointer',
              }}
            >
              <option value={0}>Off (gapless)</option>
              <option value={3}>3 seconds</option>
              <option value={5}>5 seconds</option>
              <option value={8}>8 seconds</option>
            </select>
          </div>
        </div>

        {/* Last.fm section */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Last.fm</span>
            {lastfmStatus.authenticated && (
              <span style={{ fontSize: 12, color: COLORS.success, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: COLORS.success, display: 'inline-block' }} />
                {lastfmStatus.username}
              </span>
            )}
          </div>

          {lastfmStatus.authenticated ? (
            <div>
              <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 12 }}>
                Connected as <strong style={{ color: COLORS.textPrimary }}>{lastfmStatus.username}</strong>. Scrobbling is active.
              </div>
              <button onClick={lastfmDisconnect} style={{
                padding: '8px 16px', borderRadius: 6, border: `1px solid ${COLORS.error}`,
                background: 'transparent', color: COLORS.error, fontSize: 13, cursor: 'pointer',
              }}>Disconnect</button>
              {/* Scrobble sync status */}
              <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 6, background: COLORS.hover, fontSize: 12 }}>
                {syncStatus?.state === 'syncing' ? (
                  <span style={{ color: COLORS.textSecondary }}>
                    Syncing Last.fm history… {(syncStatus.fetched || 0).toLocaleString()} / {(syncStatus.total || 0).toLocaleString()} scrobbles ({syncStatus.total ? Math.round((syncStatus.fetched / syncStatus.total) * 100) : 0}%)
                  </span>
                ) : syncStatus?.state === 'complete' ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ color: COLORS.textSecondary }}>
                      {(() => {
                        const secsAgo = Math.floor(Date.now() / 1000) - (syncStatus.lastSyncedAt || 0);
                        const hrs = Math.floor(secsAgo / 3600);
                        const count = syncStatus.total ? `${syncStatus.total.toLocaleString()} scrobbles · ` : '';
                        return hrs >= 1 ? `${count}Last synced: ${hrs}h ago` : `${count}Last synced: ${Math.floor(secsAgo / 60)}m ago`;
                      })()}
                    </span>
                    <button onClick={onSyncNow} style={{
                      padding: '4px 10px', borderRadius: 4, border: `1px solid ${COLORS.border}`,
                      background: 'transparent', color: COLORS.textPrimary, fontSize: 11, cursor: 'pointer',
                    }}>Sync Now</button>
                  </div>
                ) : syncStatus?.state === 'error' ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ color: COLORS.error }}>
                      Sync failed{syncStatus.fetched ? ` at ${syncStatus.fetched.toLocaleString()} scrobbles` : ''}: {syncStatus.error}
                    </span>
                    <button onClick={onSyncNow} style={{
                      padding: '4px 10px', borderRadius: 4, border: `1px solid ${COLORS.border}`,
                      background: 'transparent', color: COLORS.textPrimary, fontSize: 11, cursor: 'pointer',
                    }}>Retry</button>
                  </div>
                ) : (
                  <span style={{ color: COLORS.textSecondary }}>
                    Scrobble sync will start automatically once connected…
                  </span>
                )}
              </div>

              {/* Library import from scrobbles */}
              <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 6, background: COLORS.hover, fontSize: 12 }}>
                {syncStatus?.state === 'complete' ? (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ color: COLORS.textPrimary, fontWeight: 600 }}>Import to Library</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ color: COLORS.textSecondary }}>From last</span>
                      <input
                        type="number"
                        min={1}
                        max={3650}
                        value={importDays}
                        onChange={e => setImportDays(parseInt(e.target.value, 10) || 60)}
                        style={{
                          width: 60, padding: '3px 6px', borderRadius: 4, border: `1px solid ${COLORS.border}`,
                          background: COLORS.surface, color: COLORS.textPrimary, fontSize: 12, textAlign: 'center',
                        }}
                      />
                      <span style={{ color: COLORS.textSecondary }}>days of scrobbles</span>
                      <button
                        onClick={handleImport}
                        disabled={importing}
                        style={{
                          marginLeft: 'auto', padding: '4px 12px', borderRadius: 4, border: 'none',
                          background: importing ? COLORS.hover : COLORS.accent,
                          color: importing ? COLORS.textSecondary : '#fff',
                          fontSize: 12, fontWeight: 600, cursor: importing ? 'default' : 'pointer',
                        }}
                      >
                        {importing ? 'Importing…' : 'Import'}
                      </button>
                    </div>
                    {importResult && (
                      <div style={{ color: importResult.error ? COLORS.error : COLORS.textSecondary, lineHeight: 1.6 }}>
                        {importResult.error ? (
                          importResult.error
                        ) : (
                          <>
                            Found {importResult.found} albums by {importResult.artists} artists.
                            {importResult.alreadyInLibrary > 0 && ` ${importResult.alreadyInLibrary} already in library.`}
                            {importResult.alreadyQueued > 0 && ` ${importResult.alreadyQueued} already queued.`}
                            {importResult.queued > 0 && ` ${importResult.queued} queued for download.`}
                            {importResult.queued === 0 && importResult.found > 0 && importResult.alreadyInLibrary === 0 && importResult.alreadyQueued === 0 && ' Nothing new to queue.'}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <span style={{ color: COLORS.textSecondary, opacity: 0.6 }}>
                    Library import available after scrobble sync completes.
                  </span>
                )}
              </div>
            </div>
          ) : lastfmAuthStep === 1 ? (
            <div>
              <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 12 }}>
                Step 2: Authorize Not-ify on Last.fm, then click the button below.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <a href={lastfmAuthUrl} target="_blank" rel="noopener noreferrer" style={{
                  padding: '8px 16px', borderRadius: 6, border: 'none', textDecoration: 'none',
                  background: '#d51007', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}>Open Last.fm</a>
                <button onClick={lastfmCompleteAuth} style={{
                  padding: '8px 16px', borderRadius: 6, border: `1px solid ${COLORS.border}`,
                  background: COLORS.hover, color: COLORS.textPrimary, fontSize: 13, cursor: 'pointer',
                }}>I've Authorized</button>
              </div>
              {lastfmError && <div style={{ color: COLORS.error, fontSize: 12, marginTop: 8 }}>{lastfmError}</div>}
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 12 }}>
                Enter your Last.fm API credentials.{' '}
                <a href="https://www.last.fm/api/account/create" target="_blank" rel="noopener noreferrer"
                  style={{ color: COLORS.accent }}>Get API key</a>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
                <input type="text" placeholder="API Key" value={lastfmApiKey} onChange={e => setLastfmApiKey(e.target.value)}
                  style={inputStyle} />
                <input type="text" placeholder="Shared Secret" value={lastfmApiSecret} onChange={e => setLastfmApiSecret(e.target.value)}
                  style={inputStyle} />
              </div>
              <button onClick={lastfmSaveConfig} disabled={!lastfmApiKey || !lastfmApiSecret} style={{
                padding: '8px 20px', borderRadius: 6, border: 'none',
                background: lastfmApiKey && lastfmApiSecret ? COLORS.accent : COLORS.hover,
                color: lastfmApiKey && lastfmApiSecret ? '#fff' : COLORS.textSecondary,
                fontSize: 13, fontWeight: 600, cursor: lastfmApiKey && lastfmApiSecret ? 'pointer' : 'default',
              }}>Connect</button>
              {lastfmError && <div style={{ color: COLORS.error, fontSize: 12, marginTop: 8 }}>{lastfmError}</div>}
            </div>
          )}
        </div>

        {/* Real-Debrid section — admin only */}
        {isAdmin && rdConfig && (
          <div style={{ ...sectionStyle, marginTop: 24 }}>
            <div style={sectionHeaderStyle}>
              <span style={sectionTitleStyle}>Real-Debrid</span>
              <StatusDot status={rdConfig.status?.configured ? 'ok' : null} />
            </div>
            {rdConfig.status?.configured && (
              <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 8 }}>
                Token: {rdConfig.status.tokenPreview}
              </div>
            )}
            <input
              type="password"
              placeholder={rdConfig.status?.configured ? 'Enter new token to update' : 'Enter API token'}
              style={inputStyle}
              onChange={(e) => setRdToken(e.target.value)}
              value={rdToken}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                onClick={() => rdConfig.save({ apiToken: rdToken })}
                disabled={rdConfig.saving}
                style={rdConfig.saving ? buttonDisabledStyle : buttonPrimaryStyle}
              >
                {rdConfig.saving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => rdConfig.test()}
                disabled={rdConfig.testing}
                style={rdConfig.testing ? buttonDisabledStyle : buttonSecondaryStyle}
              >
                {rdConfig.testing ? 'Testing...' : 'Test Connection'}
              </button>
            </div>
            {rdConfig.testResult && (
              <div style={{ marginTop: 8, fontSize: 12, color: rdConfig.testResult.status === 'ok' ? COLORS.success : COLORS.error }}>
                {rdConfig.testResult.status === 'ok'
                  ? `Premium — ${rdConfig.testResult.user?.username}, expires ${rdConfig.testResult.user?.expiration?.slice(0, 10)}`
                  : rdConfig.testResult.error}
              </div>
            )}
          </div>
        )}

        {/* VPN section — admin only */}
        {isAdmin && vpnConfig && (
          <div style={{ ...sectionStyle, marginTop: 24 }}>
            <div style={sectionHeaderStyle}>
              <span style={sectionTitleStyle}>VPN (PIA)</span>
              <StatusDot status={vpnConfig.status?.configured ? 'ok' : null} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 8 }}>
              <input
                type="text"
                placeholder="PIA username"
                value={vpnUser}
                onChange={(e) => setVpnUser(e.target.value)}
                style={inputStyle}
              />
              <input
                type="password"
                placeholder="PIA password"
                value={vpnPass}
                onChange={(e) => setVpnPass(e.target.value)}
                style={inputStyle}
              />
              <select
                value={vpnRegion}
                onChange={(e) => setVpnRegion(e.target.value)}
                style={inputStyle}
              >
                <option value="">Select region...</option>
                {(vpnRegions || []).map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                onClick={async () => {
                  await vpnConfig.save({ username: vpnUser, password: vpnPass, region: vpnRegion });
                  if (vpnRegion) {
                    try {
                      await switchVpnRegion(vpnRegion);
                      // Auto-test after region switch to verify new connection
                      setTimeout(() => vpnConfig.test(), 5000);
                    } catch {}
                  }
                }}
                disabled={vpnConfig.saving}
                style={vpnConfig.saving ? buttonDisabledStyle : buttonPrimaryStyle}
              >
                {vpnConfig.saving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => vpnConfig.test()}
                disabled={vpnConfig.testing}
                style={vpnConfig.testing ? buttonDisabledStyle : buttonSecondaryStyle}
              >
                {vpnConfig.testing ? 'Testing...' : 'Test Connection'}
              </button>
            </div>
            {vpnConfig.testResult && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                {vpnConfig.testResult.status === 'proxy_unavailable' ? (
                  <div style={{ color: COLORS.textSecondary }}>
                    VPN proxy not available (dev mode)
                  </div>
                ) : (
                  <>
                    <div style={{
                      color: vpnConfig.testResult.status === 'ok' ? COLORS.success : COLORS.error,
                      marginBottom: 4,
                    }}>
                      {vpnConfig.testResult.ip
                        ? `Connected via ${vpnConfig.testResult.ip} (${vpnConfig.testResult.region})`
                        : 'VPN connection check complete'}
                    </div>
                    {vpnConfig.testResult.services && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {Object.entries(vpnConfig.testResult.services).map(([name, svc]) => (
                          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{
                              width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
                              backgroundColor: svc.status === 'ok' ? COLORS.success : COLORS.error,
                            }} />
                            <span style={{ color: COLORS.textPrimary }}>{name}</span>
                            <span style={{ color: COLORS.textSecondary }}>
                              {svc.status === 'ok' ? `${svc.latency}ms` : svc.error}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
