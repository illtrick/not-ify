import React from 'react';
import { COLORS } from '../constants';
import { Icon } from './Icon';

// ---------------------------------------------------------------------------
// TrackStatusIcon — render a subtle status indicator for a track
// ---------------------------------------------------------------------------
export function TrackStatusIcon({ status }) {
  if (!status) return null;
  if (status === 'library') return <span title="In library" style={{ opacity: 0.5, flexShrink: 0, display: 'flex', alignItems: 'center', marginLeft: 4 }}>{Icon.checkCircle(13, COLORS.success)}</span>;
  if (status === 'active') return <span title="Downloading" className="spin-slow" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', marginLeft: 4 }}>{Icon.downloading(13, COLORS.accent)}</span>;
  if (status === 'queued') return <span title="Queued" style={{ opacity: 0.4, flexShrink: 0, display: 'flex', alignItems: 'center', marginLeft: 4 }}>{Icon.clock(13, COLORS.textSecondary)}</span>;
  return null;
}

export default TrackStatusIcon;
