import React from 'react';
import { QualityBadge } from './QualityBadge';

// ---------------------------------------------------------------------------
// TrackStatusIcon — render a quality/status badge for a track
// Used in MB search preview track lists where we don't have format info yet
// ---------------------------------------------------------------------------
export function TrackStatusIcon({ fileStatus, format }) {
  if (!fileStatus && !format) return null;

  return (
    <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', marginLeft: 4 }}>
      <QualityBadge format={format} fileStatus={fileStatus} />
    </span>
  );
}

export default TrackStatusIcon;
