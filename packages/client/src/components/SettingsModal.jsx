import React, { useState, useEffect, useCallback } from 'react';
import { COLORS } from '../constants';
import { Icon } from './Icon';
import { importFromLastfm, switchVpnRegion, getActiveJobs, getLibraryFilesCount, migrateLibrary } from '@not-ify/shared';
import { FolderBrowser } from './FolderBrowser';

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
  slskConfig,
  onSlskSave,
  onSlskTest,
  libraryConfig,
  onLibrarySave,
  onServerRestart,
}) {
  const [rdToken, setRdToken] = useState('');
  const [vpnUser, setVpnUser] = useState('');
  const [vpnPass, setVpnPass] = useState('');
  const [vpnRegion, setVpnRegion] = useState('US East');
  const [vpnProvider, setVpnProvider] = useState('');
  const [vpnCustomProvider, setVpnCustomProvider] = useState('');
  const [vpnProviders, setVpnProviders] = useState([]);
  const [providerRegions, setProviderRegions] = useState([]);

  // Soulseek inputs
  const [slskUsername, setSlskUsername] = useState('');
  const [slskPassword, setSlskPassword] = useState('');

  // Library / folder browser state
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [pendingLibraryPath, setPendingLibraryPath] = useState(null);
  // Steps: null | 'confirm' | 'migration' | 'restarting'
  const [libraryStep, setLibraryStep] = useState(null);
  const [libraryActiveJobs, setLibraryActiveJobs] = useState(null);
  const [libraryFilesCount, setLibraryFilesCount] = useState(null);
  const [migrationProgress, setMigrationProgress] = useState(null);
  const [libraryError, setLibraryError] = useState(null);

  // Pre-fill Soulseek username from saved config
  useEffect(() => {
    if (slskConfig?.status?.username && !slskUsername) {
      setSlskUsername(slskConfig.status.username);
    }
  }, [slskConfig?.status?.username]);

  // Handle path selected from folder browser — fetch active jobs + files count, then show confirm step
  const handlePathSelected = useCallback(async (path) => {
    setShowFolderBrowser(false);

    // Same path selected — no-op
    const currentNorm = (libraryConfig?.musicDir || '').replace(/[\\/]+/g, '/').replace(/\/+$/, '');
    const selectedNorm = (path || '').replace(/[\\/]+/g, '/').replace(/\/+$/, '');
    if (currentNorm === selectedNorm) {
      setLibraryError(null);
      setPendingLibraryPath(null);
      setLibraryStep(null);
      return; // Already using this path, nothing to do
    }

    setPendingLibraryPath(path);
    setLibraryError(null);
    setLibraryActiveJobs(null);
    setLibraryFilesCount(null);
    setMigrationProgress(null);

    try {
      const [jobs, files] = await Promise.all([
        getActiveJobs().catch(() => ({ activeJobs: 0, types: [] })),
        getLibraryFilesCount(libraryConfig?.musicDir).catch(() => ({ count: 0, totalSizeMB: 0 })),
      ]);
      setLibraryActiveJobs(jobs);
      setLibraryFilesCount(files);
      setLibraryStep('confirm');
    } catch (err) {
      setLibraryError(`Failed to check server state: ${err.message}`);
      setLibraryStep('confirm');
    }
  }, [libraryConfig?.musicDir]);

  // Save config + restart server, then poll for reconnect
  const handleApplyAndRestart = useCallback(async () => {
    setLibraryStep('restarting');
    try {
      if (onLibrarySave) await onLibrarySave(pendingLibraryPath);
      if (onServerRestart) onServerRestart();
      setPendingLibraryPath(null);
    } catch (err) {
      setLibraryError(`Failed to save: ${err.message}`);
      setLibraryStep('confirm');
    }
  }, [pendingLibraryPath, onLibrarySave, onServerRestart]);

  // Save config but defer restart (when jobs are active)
  const handleWaitAndApply = useCallback(async () => {
    try {
      if (onLibrarySave) await onLibrarySave(pendingLibraryPath);
      setLibraryStep(null);
      setPendingLibraryPath(null);
    } catch (err) {
      setLibraryError(`Failed to save: ${err.message}`);
    }
  }, [pendingLibraryPath, onLibrarySave]);

  // Proceed to migration step
  const handleShowMigration = useCallback(() => {
    setLibraryStep('migration');
  }, []);

  // Perform migration (copy files) then restart
  const handleMigrate = useCallback(async () => {
    setMigrationProgress({ copying: true, copied: 0, total: libraryFilesCount?.count || 0, progress: '0/? files' });
    try {
      await migrateLibrary(libraryConfig?.musicDir, pendingLibraryPath, (data) => {
        setMigrationProgress(data);
        if (data.done) {
          // Migration complete — now save and restart
          handleApplyAndRestart();
        }
      });
    } catch (err) {
      setLibraryError(`Migration failed: ${err.message}`);
      setLibraryStep('migration');
      setMigrationProgress(null);
    }
  }, [libraryConfig?.musicDir, pendingLibraryPath, libraryFilesCount, handleApplyAndRestart]);

  // Cancel the library change flow
  const handleLibraryCancel = useCallback(() => {
    setLibraryStep(null);
    setPendingLibraryPath(null);
    setLibraryActiveJobs(null);
    setLibraryFilesCount(null);
    setMigrationProgress(null);
    setLibraryError(null);
  }, []);

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
      if (vpnConfig.status.provider) setVpnProvider(vpnConfig.status.provider);
    }
  }, [vpnConfig?.status]);

  // Load VPN providers list
  useEffect(() => {
    if (isAdmin) {
      import('@not-ify/shared').then(api => {
        api.getVpnProviders().then(providers => setVpnProviders(providers)).catch(() => {});
      });
    }
  }, [isAdmin]);

  // Load regions when provider changes
  useEffect(() => {
    if (vpnProvider && vpnProvider !== 'custom') {
      import('@not-ify/shared').then(api => {
        api.getVpnProviderRegions(vpnProvider).then(regions => setProviderRegions(regions)).catch(() => setProviderRegions([]));
      });
    }
  }, [vpnProvider]);

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
              <span style={sectionTitleStyle}>VPN</span>
              <StatusDot status={vpnConfig.status?.configured ? 'ok' : null} />
            </div>
            {vpnConfig.testResult?.ip && (
              <div style={{ fontSize: 12, color: COLORS.success, marginBottom: 8 }}>
                Connected — IP: {vpnConfig.testResult.ip} ({vpnConfig.testResult.region || vpnRegion})
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 8 }}>
              <select
                value={vpnProvider}
                onChange={(e) => {
                  setVpnProvider(e.target.value);
                  setVpnRegion('');
                  // Fetch regions for new provider
                  if (e.target.value) {
                    import('@not-ify/shared').then(api => {
                      api.getVpnProviderRegions(e.target.value).then(regions => {
                        setProviderRegions(regions);
                      }).catch(() => setProviderRegions([]));
                    });
                  }
                }}
                style={inputStyle}
              >
                <option value="">Select VPN provider...</option>
                {(vpnProviders || []).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                <option value="custom">Other (enter gluetun provider name)</option>
              </select>
              {vpnProvider === 'custom' && (
                <input
                  type="text"
                  placeholder="Gluetun provider name (e.g., vyprvpn)"
                  value={vpnCustomProvider}
                  onChange={(e) => setVpnCustomProvider(e.target.value)}
                  style={inputStyle}
                />
              )}
              <input
                type="text"
                placeholder="Username"
                value={vpnUser}
                onChange={(e) => setVpnUser(e.target.value)}
                style={inputStyle}
              />
              <input
                type="password"
                placeholder="Password"
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
                {(providerRegions.length > 0 ? providerRegions : vpnRegions || []).map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            {vpnConfig.saving && (
              <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 8 }}>
                Saving... Restarting VPN container...
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                onClick={async () => {
                  const provider = vpnProvider === 'custom' ? vpnCustomProvider : vpnProvider;
                  await vpnConfig.save({ username: vpnUser, password: vpnPass, region: vpnRegion, provider });
                  // Auto-test after save to verify connection
                  setTimeout(() => vpnConfig.test(), 10000);
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
            <div style={{ fontSize: 11, color: COLORS.textSecondary, marginTop: 8 }}>
              Don't have a VPN? Not-ify works without one — torrent downloads will use your regular connection.
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

        {/* Soulseek section — admin only */}
        {isAdmin && slskConfig && (
          <div style={{ ...sectionStyle, marginTop: 24 }}>
            <div style={sectionHeaderStyle}>
              <span style={sectionTitleStyle}>Soulseek</span>
              <StatusDot status={slskConfig.status?.connected ? 'ok' : slskConfig.status?.configured ? 'error' : null} />
            </div>
            {slskConfig.status?.configured && (
              <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 8 }}>
                Logged in as <strong style={{ color: COLORS.textPrimary }}>{slskConfig.status.username}</strong>
                {slskConfig.status.state && <span> — {slskConfig.status.state}</span>}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 8 }}>
              <input
                type="text"
                placeholder="Soulseek username"
                value={slskUsername}
                onChange={e => setSlskUsername(e.target.value)}
                style={inputStyle}
              />
              <input
                type="password"
                placeholder={slskConfig.status?.configured ? 'Enter new password to update' : 'Soulseek password'}
                value={slskPassword}
                onChange={e => setSlskPassword(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                onClick={() => onSlskSave && onSlskSave(slskUsername, slskPassword)}
                disabled={slskConfig.saving || (!slskUsername && !slskPassword)}
                style={slskConfig.saving || (!slskUsername && !slskPassword) ? buttonDisabledStyle : buttonPrimaryStyle}
              >
                {slskConfig.saving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => onSlskTest && onSlskTest()}
                disabled={slskConfig.testing}
                style={slskConfig.testing ? buttonDisabledStyle : buttonSecondaryStyle}
              >
                {slskConfig.testing ? 'Testing...' : 'Test Connection'}
              </button>
            </div>
            {slskConfig.testResult && (
              <div style={{ marginTop: 8, fontSize: 12, color: slskConfig.testResult.status === 'ok' ? COLORS.success : COLORS.error }}>
                {slskConfig.testResult.status === 'ok'
                  ? `Connected as ${slskConfig.testResult.username || 'unknown'}${slskConfig.testResult.version ? ` — slskd v${slskConfig.testResult.version}` : ''}`
                  : slskConfig.testResult.error}
              </div>
            )}
          </div>
        )}

        {/* Music Library section — admin only */}
        {isAdmin && libraryConfig && (
          <div style={{ ...sectionStyle, marginTop: 24 }}>
            <div style={sectionHeaderStyle}>
              <span style={sectionTitleStyle}>Music Library</span>
            </div>
            <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 4 }}>
              Current path:
            </div>
            <div style={{ fontSize: 13, color: COLORS.textPrimary, marginBottom: 4, wordBreak: 'break-all' }}>
              {libraryConfig.musicDir}
            </div>
            <div style={{ fontSize: 11, color: COLORS.textSecondary, marginBottom: 10 }}>
              Source:{' '}
              {libraryConfig.source === 'db' ? 'saved setting'
                : libraryConfig.source === 'env' ? 'environment variable'
                : 'default'}
            </div>
            {libraryConfig.isDocker && (
              <div style={{
                padding: '8px 10px', borderRadius: 5, background: COLORS.hover,
                fontSize: 11, color: COLORS.textSecondary, marginBottom: 10,
              }}>
                Running in Docker — make sure any new path is covered by a bind mount.
              </div>
            )}

            {/* Folder browser toggle */}
            {!showFolderBrowser && libraryStep !== 'restarting' && (
              <button
                onClick={() => setShowFolderBrowser(true)}
                style={buttonSecondaryStyle}
              >
                Change Location
              </button>
            )}
            {showFolderBrowser && (
              <FolderBrowser
                initialPath={libraryConfig.musicDir}
                onCancel={() => setShowFolderBrowser(false)}
                onSelect={handlePathSelected}
              />
            )}

            {/* Error display */}
            {libraryError && (
              <div style={{ marginTop: 8, fontSize: 12, color: COLORS.error }}>
                {libraryError}
              </div>
            )}

            {/* Step 1: Confirmation dialog */}
            {libraryStep === 'confirm' && pendingLibraryPath && (
              <div style={{
                marginTop: 12, padding: '12px 14px', borderRadius: 6,
                background: COLORS.hover, border: `1px solid ${COLORS.border}`,
              }}>
                <div style={{ fontSize: 13, color: COLORS.textPrimary, marginBottom: 6 }}>
                  Change music library to:
                </div>
                <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 10, wordBreak: 'break-all' }}>
                  {pendingLibraryPath}
                </div>

                {/* Active jobs warning */}
                {libraryActiveJobs && libraryActiveJobs.activeJobs > 0 ? (
                  <>
                    <div style={{ fontSize: 12, color: COLORS.error, marginBottom: 10 }}>
                      {libraryActiveJobs.activeJobs} download{libraryActiveJobs.activeJobs !== 1 ? 's' : ''} in progress
                      {libraryActiveJobs.types?.length > 0 ? ` (${libraryActiveJobs.types.join(', ')})` : ''}.
                      What would you like to do?
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        onClick={handleWaitAndApply}
                        style={buttonSecondaryStyle}
                        title="Save the new path but don't restart yet — downloads will finish first"
                      >
                        Wait &amp; Apply After
                      </button>
                      <button
                        onClick={() => {
                          if (libraryFilesCount && libraryFilesCount.count > 0) {
                            handleShowMigration();
                          } else {
                            handleApplyAndRestart();
                          }
                        }}
                        style={buttonPrimaryStyle}
                      >
                        Cancel Downloads &amp; Restart Now
                      </button>
                      <button onClick={handleLibraryCancel} style={buttonSecondaryStyle}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 10 }}>
                      This requires a server restart.
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => {
                          if (libraryFilesCount && libraryFilesCount.count > 0) {
                            handleShowMigration();
                          } else {
                            handleApplyAndRestart();
                          }
                        }}
                        style={buttonPrimaryStyle}
                      >
                        Apply &amp; Restart
                      </button>
                      <button onClick={handleLibraryCancel} style={buttonSecondaryStyle}>Cancel</button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Step 2: Migration offer */}
            {libraryStep === 'migration' && pendingLibraryPath && (
              <div style={{
                marginTop: 12, padding: '12px 14px', borderRadius: 6,
                background: COLORS.hover, border: `1px solid ${COLORS.border}`,
              }}>
                {migrationProgress ? (
                  /* Migration in progress */
                  <div>
                    <div style={{ fontSize: 13, color: COLORS.textPrimary, marginBottom: 8 }}>
                      Migrating files...
                    </div>
                    <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 8 }}>
                      {migrationProgress.progress}
                    </div>
                    <div style={{
                      height: 4, borderRadius: 2, background: COLORS.border, overflow: 'hidden',
                    }}>
                      <div style={{
                        height: '100%', borderRadius: 2, background: COLORS.accent,
                        width: migrationProgress.total > 0
                          ? `${Math.round((migrationProgress.copied / migrationProgress.total) * 100)}%`
                          : '0%',
                        transition: 'width 0.3s ease',
                      }} />
                    </div>
                  </div>
                ) : (
                  /* Migration offer */
                  <div>
                    <div style={{ fontSize: 13, color: COLORS.textPrimary, marginBottom: 6 }}>
                      Migrate existing files?
                    </div>
                    <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 10 }}>
                      Your current library has {libraryFilesCount.count} file{libraryFilesCount.count !== 1 ? 's' : ''} ({libraryFilesCount.totalSizeMB} MB).
                      Would you like to copy them to the new location?
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={handleMigrate} style={buttonPrimaryStyle}>
                        Migrate
                      </button>
                      <button onClick={handleApplyAndRestart} style={buttonSecondaryStyle}>
                        Start Fresh
                      </button>
                      <button onClick={handleLibraryCancel} style={buttonSecondaryStyle}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Restarting spinner */}
            {libraryStep === 'restarting' && (
              <div style={{
                marginTop: 12, padding: '16px 14px', borderRadius: 6,
                background: COLORS.hover, border: `1px solid ${COLORS.border}`,
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 13, color: COLORS.textPrimary, marginBottom: 8 }}>
                  Restarting server...
                </div>
                <div style={{ fontSize: 12, color: COLORS.textSecondary }}>
                  Waiting for server to come back online
                </div>
                <div style={{
                  marginTop: 10, width: 20, height: 20, borderRadius: '50%',
                  border: `2px solid ${COLORS.border}`, borderTopColor: COLORS.accent,
                  animation: 'spin 1s linear infinite',
                  display: 'inline-block',
                }} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
