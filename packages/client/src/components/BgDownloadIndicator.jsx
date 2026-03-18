import React from 'react';
import { COLORS } from '../constants';
import { Icon } from './Icon';

export function BgDownloadIndicator({ bgDownloadStatus, setBgDownloadStatus }) {
  if (!bgDownloadStatus) return null;
  return (
    <div style={{
      padding: '6px 12px', fontSize: 11, color: bgDownloadStatus.done ? COLORS.success : COLORS.accent,
      background: COLORS.hover, borderTop: `1px solid ${COLORS.border}`,
      display: 'flex', alignItems: 'center', gap: 6, cursor: 'default',
    }}>
      {!bgDownloadStatus.done && (
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS.accent, animation: 'pulse 1.5s ease-in-out infinite' }} />
      )}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {bgDownloadStatus.message}
      </span>
      {bgDownloadStatus.done && (
        <button onClick={() => setBgDownloadStatus(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          {Icon.close(12, COLORS.textSecondary)}
        </button>
      )}
    </div>
  );
}
