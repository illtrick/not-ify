import React from 'react';
import { COLORS } from '../constants';
import { Icon } from './Icon';

export function BgDownloadIndicator({ bgDownloadStatus, setBgDownloadStatus, jobQueueStats, onToggleLog }) {
  // Build composite message from both download status and job queue
  const parts = [];

  const hasBgDownload = bgDownloadStatus && !bgDownloadStatus.done;
  const hasBgDone = bgDownloadStatus?.done;

  // Active download jobs (YT queue / torrent bg)
  if (hasBgDownload) {
    const count = bgDownloadStatus.count;
    if (count > 0) {
      parts.push(`Downloading: ${count} track${count !== 1 ? 's' : ''}`);
    } else {
      parts.push(bgDownloadStatus.message || 'Downloading...');
    }
  }

  // Active upgrade jobs
  const activeUpgrades = jobQueueStats ? jobQueueStats.active + jobQueueStats.pending : 0;
  if (activeUpgrades > 0) {
    parts.push(`Upgrading: ${activeUpgrades} album${activeUpgrades !== 1 ? 's' : ''}`);
  }

  const isActive = hasBgDownload || activeUpgrades > 0;
  const isDone = hasBgDone && !activeUpgrades;

  if (!isActive && !isDone) return null;

  const message = isDone
    ? (bgDownloadStatus?.message || 'All saved!')
    : parts.length > 0
      ? parts.join(' | ')
      : 'Working...';

  const color = isDone ? COLORS.success : COLORS.accent;

  return (
    <div
      onClick={onToggleLog}
      style={{
        padding: '6px 12px', fontSize: 11, color,
        background: COLORS.hover, borderTop: `1px solid ${COLORS.border}`,
        display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
      }}
      title="Click to view activity log"
    >
      {isActive && (
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS.accent, animation: 'pulse 1.5s ease-in-out infinite', flexShrink: 0 }} />
      )}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {message}
      </span>
      <span style={{ fontSize: 10, color: COLORS.textSecondary, flexShrink: 0 }}>▲ Log</span>
      {isDone && (
        <button onClick={(e) => { e.stopPropagation(); setBgDownloadStatus(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          {Icon.close(12, COLORS.textSecondary)}
        </button>
      )}
    </div>
  );
}
