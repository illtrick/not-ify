import React from 'react';

// Quality color tiers
const FORMAT_COLORS = {
  // Lossy — amber
  mp3: { color: '#F59E0B', bg: 'rgba(245,158,11,0.15)' },
  aac: { color: '#F59E0B', bg: 'rgba(245,158,11,0.15)' },
  wma: { color: '#F59E0B', bg: 'rgba(245,158,11,0.15)' },
  ogg: { color: '#F59E0B', bg: 'rgba(245,158,11,0.15)' },
  opus: { color: '#F59E0B', bg: 'rgba(245,158,11,0.15)' },
  m4a: { color: '#F59E0B', bg: 'rgba(245,158,11,0.15)' },
  // Lossless — cyan
  flac: { color: '#06B6D4', bg: 'rgba(6,182,212,0.15)' },
  alac: { color: '#06B6D4', bg: 'rgba(6,182,212,0.15)' },
  wav: { color: '#06B6D4', bg: 'rgba(6,182,212,0.15)' },
  aiff: { color: '#06B6D4', bg: 'rgba(6,182,212,0.15)' },
};

const badgeBase = {
  fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 3,
  letterSpacing: '0.03em', display: 'inline-flex', alignItems: 'center',
  gap: 3, textAlign: 'center', minWidth: 38,
};

export function QualityBadge({ format, fileStatus }) {
  // Error states
  if (fileStatus === 'error' || fileStatus === 'infected') {
    return <span style={{ ...badgeBase, background: 'rgba(239,68,68,0.15)', color: '#EF4444' }}>{'\u2715'}</span>;
  }

  // Upgrading: show current format with animated up arrow
  if (fileStatus === 'upgrading' && format) {
    const tier = FORMAT_COLORS[format.toLowerCase()] || { color: '#b0b0b0', bg: 'rgba(176,176,176,0.12)' };
    return (
      <span style={{ ...badgeBase, background: tier.bg, color: tier.color }}>
        {format.toUpperCase()}
        <span className="badge-upgrade-arrow" style={{ color: '#06B6D4', fontSize: 11 }}>{'\u2191'}</span>
      </span>
    );
  }

  // Downloaded: show format badge
  if (format && (fileStatus === 'available' || !fileStatus)) {
    const tier = FORMAT_COLORS[format.toLowerCase()] || { color: '#b0b0b0', bg: 'rgba(176,176,176,0.12)' };
    return <span style={{ ...badgeBase, background: tier.bg, color: tier.color }}>{format.toUpperCase()}</span>;
  }

  // Streamable: blue play icon
  if (fileStatus === 'streamable') {
    return <span style={{ ...badgeBase, background: 'rgba(107,138,255,0.15)', color: '#6B8AFF' }}>{'\u25B6'}</span>;
  }

  // Processing: pulsing dot
  if (fileStatus === 'processing') {
    return <span className="badge-processing" style={{ ...badgeBase, background: 'rgba(176,176,176,0.12)', color: '#b0b0b0' }}>{'\u25C9'}</span>;
  }

  // Untouched: dash
  return <span style={{ fontSize: 13, color: '#555' }}>{'\u2014'}</span>;
}

export default QualityBadge;
