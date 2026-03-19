import React from 'react';

// Quality color tiers — amber (low lossy) → lime (good lossy) → green (lossless) → cyan (hi-res)
const QUALITY_COLORS = {
  // Low bitrate lossy
  mp3: { color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },     // amber (default MP3 assumed low)
  aac: { color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  wma: { color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  // Good lossy
  ogg: { color: '#a3e635', bg: 'rgba(163,230,53,0.12)' },      // lime
  opus: { color: '#a3e635', bg: 'rgba(163,230,53,0.12)' },
  m4a: { color: '#a3e635', bg: 'rgba(163,230,53,0.12)' },
  // Lossless
  flac: { color: '#4caf50', bg: 'rgba(76,175,80,0.15)' },      // green
  alac: { color: '#4caf50', bg: 'rgba(76,175,80,0.15)' },
  wav: { color: '#4caf50', bg: 'rgba(76,175,80,0.15)' },
  aiff: { color: '#4caf50', bg: 'rgba(76,175,80,0.15)' },
};

// Downloading state badge with progress bar animation
function DownloadBadge({ progress }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 3,
      letterSpacing: '0.03em', display: 'inline-block', textAlign: 'center', minWidth: 38,
      position: 'relative', overflow: 'hidden',
      background: 'rgba(233,69,96,0.1)', color: '#e94560',
    }}>
      <span style={{
        position: 'absolute', left: 0, top: 0, bottom: 0,
        background: 'rgba(233,69,96,0.2)', borderRadius: 3,
        width: `${progress || 0}%`, transition: 'width 0.3s ease',
      }} />
      <span style={{ position: 'relative', zIndex: 1 }}>{progress != null ? `${progress}%` : '...'}</span>
    </span>
  );
}

// Queued state badge
function QueuedBadge() {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 3,
      letterSpacing: '0.03em', display: 'inline-block', textAlign: 'center', minWidth: 38,
      background: 'rgba(176,176,176,0.12)', color: '#b0b0b0',
    }}>QUEUED</span>
  );
}

export function QualityBadge({ format, status, progress }) {
  // Status states take priority
  if (status === 'active') return <DownloadBadge progress={progress} />;
  if (status === 'queued') return <QueuedBadge />;

  // No format = not downloaded
  if (!format) return <span style={{ fontSize: 13, color: '#b0b0b0' }}>—</span>;

  const key = format.toLowerCase().replace(/[^a-z0-9]/g, '');
  const tier = QUALITY_COLORS[key] || { color: '#b0b0b0', bg: 'rgba(176,176,176,0.12)' };

  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 3,
      letterSpacing: '0.03em', display: 'inline-block', textAlign: 'center', minWidth: 38,
      background: tier.bg, color: tier.color,
    }}>{format.toUpperCase()}</span>
  );
}

export default QualityBadge;
