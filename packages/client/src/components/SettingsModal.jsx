import React, { useState, useEffect } from 'react';
import { COLORS } from '../constants';
import { Icon } from './Icon';

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
}) {
  const [rdToken, setRdToken] = useState('');
  const [vpnUser, setVpnUser] = useState('');
  const [vpnPass, setVpnPass] = useState('');
  const [vpnRegion, setVpnRegion] = useState('US East');

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
                {(vpnRegions || []).map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                onClick={() => vpnConfig.save({ username: vpnUser, password: vpnPass, region: vpnRegion })}
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
              <div style={{
                marginTop: 8, fontSize: 12,
                color: vpnConfig.testResult.status === 'ok'
                  ? COLORS.success
                  : vpnConfig.testResult.status === 'proxy_unavailable'
                    ? COLORS.textSecondary
                    : COLORS.error,
              }}>
                {vpnConfig.testResult.status === 'ok'
                  ? `Connected via ${vpnConfig.testResult.ip} (${vpnConfig.testResult.region})`
                  : vpnConfig.testResult.status === 'proxy_unavailable'
                    ? 'VPN proxy not available (dev mode)'
                    : vpnConfig.testResult.error}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
