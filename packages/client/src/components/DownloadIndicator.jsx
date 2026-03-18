import React from 'react';
import { COLORS } from '../constants';
import { Icon } from './Icon';

export function DownloadIndicator({
  downloadStatus, setDownloadStatus,
  downloading,
  dlExpanded, setDlExpanded,
  handleCancel, handleYtCancel,
  loadLibrary,
}) {
  if (!downloadStatus && !downloading) return null;
  const isDone = downloadStatus?.complete || downloadStatus?.error || downloadStatus?.cancelled;
  const dots = [1, 2, 3, 4].map(s => {
    if (!downloadStatus?.step) return COLORS.border;
    if (s < downloadStatus.step) return COLORS.success;
    if (s === downloadStatus.step) return COLORS.accent;
    return COLORS.border;
  });

  return (
    <div style={{ marginTop: 'auto', padding: 12 }}>
      <div style={{ background: COLORS.hover, borderRadius: 8, padding: '10px 12px', border: `1px solid ${COLORS.border}`, fontSize: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
              {dots.map((c, i) => <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />)}
            </div>
            {downloadStatus?.albumName && (
              <div style={{ fontSize: 11, color: COLORS.accentHover, marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {downloadStatus.artist ? `${downloadStatus.artist} — ${downloadStatus.albumName}` : downloadStatus.albumName}
              </div>
            )}
            <div style={{ fontSize: 11, color: COLORS.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {downloadStatus?.message || 'Starting...'}
            </div>
            {downloadStatus?.percent != null && downloadStatus?.step === 3 && (
              <div style={{ height: 3, background: COLORS.border, borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
                <div style={{ height: '100%', background: COLORS.accent, width: `${downloadStatus.percent}%`, transition: 'width 0.4s ease' }} />
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {downloading && !isDone && (
              <button onClick={() => { handleCancel(); handleYtCancel(); }} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: `1px solid ${COLORS.accent}`, background: 'transparent', color: COLORS.accent, cursor: 'pointer' }}>
                Cancel
              </button>
            )}
            {isDone && (
              <button
                onClick={() => { setDownloadStatus(null); if (downloadStatus?.complete) { loadLibrary(); } }}
                style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: 'none', background: downloadStatus?.complete ? COLORS.success : COLORS.error, color: '#fff', cursor: 'pointer' }}
              >
                {downloadStatus?.complete ? 'View' : 'OK'}
              </button>
            )}
            <button
              onClick={() => setDlExpanded(v => !v)}
              style={{ padding: '3px 6px', borderRadius: 4, border: `1px solid ${COLORS.border}`, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {dlExpanded ? Icon.chevronUp(12, COLORS.textSecondary) : Icon.chevronDown(12, COLORS.textSecondary)}
            </button>
          </div>
        </div>

        {dlExpanded && downloadStatus?.logs?.length > 0 && (
          <div style={{ marginTop: 8, maxHeight: 140, overflowY: 'auto', fontSize: 10, color: COLORS.textSecondary, fontFamily: 'monospace', background: COLORS.bg, borderRadius: 4, padding: 6 }}>
            {downloadStatus.logs.map((log, i) => <div key={i} style={{ marginBottom: 2 }}>{log}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}
