import React from 'react';
import { COLORS } from '../constants';
import { Icon } from './Icon';

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
}) {
  if (!showSettings) return null;
  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: 6,
    border: `1px solid ${COLORS.border}`, background: COLORS.hover,
    color: COLORS.textPrimary, fontSize: 14, outline: 'none', boxSizing: 'border-box',
  };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={() => setShowSettings(false)}>
      <div style={{ background: COLORS.surface, borderRadius: 12, padding: 28, width: 420, maxWidth: '90vw', boxShadow: '0 12px 40px rgba(0,0,0,0.6)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontSize: 18, fontWeight: 700 }}>Settings</span>
          <button onClick={() => setShowSettings(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            {Icon.close(18, COLORS.textSecondary)}
          </button>
        </div>

        {/* Playback section */}
        <div style={{ marginBottom: 24 }}>
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
      </div>
    </div>
  );
}
