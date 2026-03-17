import React, { useState } from 'react';
import { COLORS } from '../constants';
import { Icon } from './Icon';

// ---------------------------------------------------------------------------
// StreamingTopResult — large featured card for best streaming match (mirrors TopResultCard)
// ---------------------------------------------------------------------------
export function StreamingTopResult({ result, onPlay, onDownload, isDownloading, compact }) {
  const [hovered, setHovered] = useState(false);
  const artSize = compact ? 80 : 120;
  return (
    <div
      style={{
        background: hovered ? '#222' : COLORS.card,
        borderRadius: 8, padding: compact ? 14 : 20, cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: compact ? 12 : 16,
        minHeight: compact ? 200 : 280, position: 'relative',
        transition: 'background 0.15s ease',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onPlay}
    >
      <div style={{ width: artSize, height: artSize, borderRadius: 4, overflow: 'hidden', flexShrink: 0, position: 'relative' }}>
        {result.thumbnail ? (
          <img src={result.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; }} />
        ) : (
          <div style={{ width: '100%', height: '100%', background: COLORS.hover, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{Icon.music(40, COLORS.textSecondary)}</div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: compact ? 20 : 28, fontWeight: 700, color: COLORS.textPrimary, marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {result.artist || result.title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: COLORS.textSecondary }}>
          <span style={{ padding: '3px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.08)', fontSize: 12, fontWeight: 600, color: COLORS.textPrimary }}>Artist</span>
          <span style={{
            background: result.source === 'youtube' ? 'rgba(255,0,0,0.85)' : 'rgba(255,85,0,0.85)',
            color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
          }}>
            {result.source === 'youtube' ? 'YouTube' : 'SoundCloud'}
          </span>
        </div>
      </div>
      {/* Hover buttons */}
      {hovered && (
        <div style={{ position: 'absolute', bottom: 20, right: 20, display: 'flex', gap: 8 }}>
          <button
            onClick={e => { e.stopPropagation(); if (!isDownloading) onDownload?.(); }}
            style={{
              width: 40, height: 40, borderRadius: '50%',
              background: isDownloading ? COLORS.hover : COLORS.success, border: 'none',
              cursor: isDownloading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            }}
            title="Save to library"
            disabled={isDownloading}
          >{Icon.plus(18, '#fff')}</button>
          <button
            onClick={e => { e.stopPropagation(); onPlay?.(); }}
            style={{
              width: 48, height: 48, borderRadius: '50%',
              background: COLORS.accent, border: 'none',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            }}
          >{Icon.play(20, '#fff')}</button>
        </div>
      )}
    </div>
  );
}

export default StreamingTopResult;
